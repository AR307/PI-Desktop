mod attachments;
mod catalog;
#[cfg(test)]
mod catalog_tests;
mod convert;
mod history;
mod projects;
mod replay;
#[cfg(test)]
mod tests;

use crate::{
    sessions::{self, SessionSummary},
    state::AppState,
    transcripts::CompactionRecord,
};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    sync::{atomic::Ordering, Arc},
};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct ImportRegistry {
    pub scans: HashMap<String, catalog::Catalog>,
    pub runs: HashMap<(String, String), Arc<std::sync::atomic::AtomicBool>>,
}
fn required<'a>(params: &'a Value, key: &str) -> Result<&'a str> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("{key} required"))
}
pub async fn handle(state: Arc<Mutex<AppState>>, method: &str, params: Value) -> Result<Value> {
    if method == "codex.import.scan" {
        let directory = catalog::text(&params, "directory");
        let catalog = tokio::task::spawn_blocking(move || catalog::scan(directory)).await??;
        let id = uuid::Uuid::new_v4().to_string();
        let response = json!({"scanId":id,"sourceDirectory":catalog.source,"projects":catalog.projects,"total":catalog.sessions.len(),"warnings":catalog.warnings});
        let mut st = state.lock().await;
        // One explicit wizard owns a catalog; closing it releases its source index.
        st.codex_import.scans.insert(id, catalog);
        return Ok(response);
    }
    let scan_id = required(&params, "scanId")?;
    let mut catalog = {
        let st = state.lock().await;
        st.codex_import
            .scans
            .get(scan_id)
            .cloned()
            .ok_or_else(|| anyhow!("Import scan expired; scan again"))?
    };
    match method {
        "codex.import.cancel" => {
            let mut st = state.lock().await;
            if params["release"] == true {
                catalog.cancelled.store(true, Ordering::Relaxed);
                st.codex_import.scans.remove(scan_id);
                st.codex_import.runs.retain(|(scan, _), token| {
                    if scan == scan_id {
                        token.store(true, Ordering::Relaxed);
                        false
                    } else {
                        true
                    }
                });
            } else {
                let run_id = required(&params, "runId")?;
                st.codex_import
                    .runs
                    .entry((scan_id.into(), run_id.into()))
                    .or_default()
                    .store(true, Ordering::Relaxed);
            }
            Ok(json!({"ok":true}))
        }
        "codex.import.page" => {
            let query = catalog::text(&params, "query")
                .unwrap_or_default()
                .to_lowercase();
            let project_id = catalog::text(&params, "projectId");
            let archived = params["archived"].as_bool();
            let offset = params["offset"].as_u64().unwrap_or(0) as usize;
            let limit = params["limit"].as_u64().unwrap_or(50).clamp(1, 200) as usize;
            let mut filtered: Vec<_> = catalog
                .sessions
                .values()
                .filter(|s| {
                    (query.is_empty()
                        || s.title.to_lowercase().contains(&query)
                        || s.cwd
                            .as_ref()
                            .is_some_and(|c| c.to_lowercase().contains(&query)))
                        && project_id
                            .as_ref()
                            .is_none_or(|p| s.project_id.as_ref() == Some(p))
                        && archived.is_none_or(|a| s.archived == a)
                })
                .cloned()
                .collect();
            filtered.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.id.cmp(&b.id)));
            let total = filtered.len();
            let mut page: Vec<_> = filtered.into_iter().skip(offset).take(limit).collect();
            let st = state.lock().await;
            for item in &mut page {
                item.imported = st.db.conn().query_row(
                    "SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)",
                    [format!("import-codex-{}", item.id)],
                    |row| row.get(0),
                )?;
            }
            Ok(json!({"sessions":page,"total":total}))
        }
        "codex.import.run" => {
            let id = required(&params, "externalId")?.to_string();
            let candidate = catalog
                .sessions
                .get(&id)
                .cloned()
                .ok_or_else(|| anyhow!("Session was not returned by this scan"))?;
            let session_id = format!("import-codex-{id}");
            {
                let st = state.lock().await;
                let exists: bool = st.db.conn().query_row(
                    "SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)",
                    [&session_id],
                    |r| r.get(0),
                )?;
                if exists {
                    return Ok(
                        json!({"externalId":id,"sessionId":session_id,"status":"skipped","context":"historyOnly","warnings":[]}),
                    );
                }
            }
            let run_id = required(&params, "runId")?;
            {
                let mut st = state.lock().await;
                if catalog.cancelled.load(Ordering::Relaxed) {
                    return Err(anyhow!("Import scan expired; scan again"));
                }
                catalog.cancelled = st
                    .codex_import
                    .runs
                    .entry((scan_id.into(), run_id.into()))
                    .or_default()
                    .clone();
            }
            let source = catalog.clone();
            let selected = candidate.clone();
            let converted = tokio::task::spawn_blocking(move || {
                let history = history::load(&source, &selected)?;
                convert::convert(&source, &selected, history)
            })
            .await?;
            if catalog.cancelled.load(Ordering::Relaxed) {
                return Ok(
                    json!({"externalId":id,"status":"cancelled","context":"historyOnly","warnings":[]}),
                );
            }
            let mut converted = converted?;
            let history_only = params["historyOnly"] == true;
            if !converted.complete && !history_only {
                return Ok(
                    json!({"externalId":id,"status":"needsConfirmation","context":"historyOnly","warnings":converted.warnings}),
                );
            }
            if converted.messages.is_empty() {
                return Err(anyhow!("No readable history messages"));
            }
            // A nonempty native user row survives runtime filtering even when
            // the source ended in an image-only or unfinished tool message.
            converted.messages.push(serde_json::from_value(json!({
                "id":format!("codex-import-receipt-{id}"),"role":"user","status":"complete",
                "content":if history_only { "[Imported from Codex: visible history only; prior context was not restored.]" } else { "[Imported from Codex: continuation context restored; historical tools will not run again.]" },
                "createdAt":candidate.updated_at
            }))?);
            let project_path = if params.get("projectPath").is_some() {
                catalog::text(&params, "projectPath")
            } else {
                projects::mapped_directory(candidate.cwd.as_deref(), &params["projectRoots"])?
            };
            if project_path
                .as_ref()
                .is_some_and(|p| !Path::new(p).is_dir())
            {
                return Err(anyhow!(
                    "Project directory is missing; choose a directory or import history only"
                ));
            }
            let settings = state
                .lock()
                .await
                .db
                .get_setting("app")?
                .unwrap_or(Value::Null);
            let provider = params
                .get("providerId")
                .filter(|v| v.is_string())
                .or_else(|| settings.get("defaultProviderId"));
            let model = params
                .get("modelId")
                .filter(|v| v.is_string())
                .or_else(|| settings.get("defaultModelId"));
            let summary: SessionSummary = serde_json::from_value(json!({
                "id":session_id,"title":candidate.title,"projectPath":project_path,
                "providerId":provider,"modelId":model,"mode":"agent",
                "thinkingLevel":params.get("thinkingLevel").and_then(Value::as_str).unwrap_or("off"),
                "permissionMode":"inherit","createdAt":candidate.created_at,"updatedAt":candidate.updated_at
            }))?;
            let checkpoint = CompactionRecord {
                id: uuid::Uuid::new_v4().to_string(),
                summary: if history_only {
                    "Codex history was imported for viewing only. No previous model context was restored. Ask the user for the task details before continuing.".into()
                } else {
                    String::new()
                },
                first_kept_message_id: None,
                through_message_id: converted
                    .messages
                    .last()
                    .ok_or_else(|| anyhow!("No messages"))?
                    .id
                    .clone(),
                tokens_before: 0,
                usage: None,
                retained_tail: Some(if history_only {
                    json!([])
                } else {
                    json!(converted.context)
                }),
                details: Some(
                    json!({"importSource":"codex","externalId":id,"retainedTailShape":"recent_window","sourceModel":candidate.model,"sourceReasoningEffort":candidate.reasoning_effort,"sourceWorkingDirectory":candidate.cwd,"sourceArchived":candidate.archived,"sourceProject":catalog.projects.iter().find(|p| Some(&p.id) == candidate.project_id.as_ref()),"contextStatus":if history_only {"historyOnly"} else {"restored"},"warnings":converted.warnings}),
                ),
                provider_id: None,
                model_id: None,
                created_at: summary.updated_at.clone(),
            };
            let st = state.lock().await;
            if catalog.cancelled.load(Ordering::Relaxed) {
                return Ok(
                    json!({"externalId":id,"status":"cancelled","context":"historyOnly","warnings":[]}),
                );
            }
            for blob in &converted.blobs {
                let path = st.data_dir.join(&blob.reference);
                std::fs::create_dir_all(st.data_dir.join("attachments"))?;
                use std::io::Write;
                match std::fs::OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(path)
                {
                    Ok(mut file) => file.write_all(&blob.bytes)?,
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(error.into()),
                }
            }
            projects::bind(
                &st.db,
                &catalog,
                &candidate,
                project_path.as_deref(),
                params["targetGroupId"].as_str(),
                &params["projectRoots"],
            )?;
            let imported = sessions::import_session_with_compactions(
                &st.db,
                &summary,
                &converted.messages,
                &[checkpoint],
            )?;
            Ok(
                json!({"externalId":id,"sessionId":session_id,"archived":candidate.archived,"status":if imported {"imported"} else {"skipped"},"context":if history_only {"historyOnly"} else {"restored"},"warnings":converted.warnings}),
            )
        }
        _ => Err(anyhow!("Unknown Codex import method")),
    }
}
fn same_path(a: &str, b: &str) -> bool {
    let normalize = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
    if cfg!(windows) {
        normalize(a).eq_ignore_ascii_case(&normalize(b))
    } else {
        normalize(a) == normalize(b)
    }
}

/// Imported projects are never silently replaced with PI's scratch directory.
pub fn require_bound_directory(db: &crate::db::Database, session_id: &str) -> Result<()> {
    if !session_id.starts_with("import-codex-") {
        return Ok(());
    }
    let summary = sessions::get_session_summary(db, session_id)?
        .ok_or_else(|| anyhow!("Session not found"))?;
    if summary
        .project_path
        .as_ref()
        .is_none_or(|path| !Path::new(path).is_dir())
    {
        return Err(anyhow!("CODEX_IMPORT_DIRECTORY_REQUIRED: Choose a working directory before continuing this imported conversation"));
    }
    Ok(())
}
