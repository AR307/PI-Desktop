use anyhow::{anyhow, Context, Result};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    pub title: String,
    pub cwd: Option<String>,
    pub project_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived: bool,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub directory_exists: bool,
    pub imported: bool,
    #[serde(skip)]
    pub files: Vec<PathBuf>,
    #[serde(skip)]
    pub paginated: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub roots: Vec<String>,
    pub missing_roots: Vec<String>,
    pub session_ids: Vec<String>,
}
#[derive(Clone)]
pub struct Catalog {
    pub source: PathBuf,
    pub root: PathBuf,
    pub sessions: BTreeMap<String, Candidate>,
    pub projects: Vec<Project>,
    pub history_db: Option<PathBuf>,
    pub warnings: Vec<String>,
    pub cancelled: Arc<AtomicBool>,
}
pub fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}
pub fn check(cancelled: &AtomicBool) -> Result<()> {
    if cancelled.load(Ordering::Relaxed) {
        return Err(anyhow!("IMPORT_CANCELLED"));
    }
    Ok(())
}
pub fn readonly(path: &Path) -> Result<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .with_context(|| format!("Cannot read Codex database {}", path.display()))
}
fn db_file(root: &Path, prefix: &str) -> Result<Option<PathBuf>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(version) = name
            .strip_prefix(prefix)
            .and_then(|s| s.strip_suffix(".sqlite"))
            .and_then(|s| s.parse::<u32>().ok())
        {
            files.push((version, entry.path()));
        }
    }
    files.sort_by_key(|(v, _)| *v);
    Ok(files.pop().map(|(_, p)| p))
}
pub fn has_table(db: &Connection, name: &str) -> Result<bool> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [name],
        |r| r.get(0),
    )?)
}
fn rows(db: &Connection, table: &str) -> Result<Vec<Value>> {
    let mut stmt = db.prepare(&format!("SELECT * FROM {table}"))?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map([], |row| {
        let mut object = serde_json::Map::new();
        for (i, name) in names.iter().enumerate() {
            let value = match row.get_ref(i)? {
                rusqlite::types::ValueRef::Text(s) => {
                    Value::String(String::from_utf8_lossy(s).to_string())
                }
                rusqlite::types::ValueRef::Integer(n) => Value::from(n),
                _ => Value::Null,
            };
            object.insert(name.clone(), value);
        }
        Ok(Value::Object(object))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}
fn timestamp(v: &Value, modern: &str, old: &str) -> String {
    let ms = v
        .get(modern)
        .and_then(Value::as_i64)
        .or_else(|| v.get(old).and_then(Value::as_i64).map(|n| n * 1000));
    ms.map(crate::db::ms_to_ts)
        .or_else(|| text(v, "timestamp"))
        .unwrap_or_else(|| crate::db::ms_to_ts(0))
}
fn discover(dir: &Path, paths: &mut Vec<PathBuf>) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            discover(&entry.path(), paths)?;
        } else if kind.is_file() && entry.path().extension().is_some_and(|e| e == "jsonl") {
            paths.push(entry.path());
        }
    }
    Ok(())
}
pub fn scan(directory: Option<String>) -> Result<Catalog> {
    let root = match directory.filter(|s| !s.trim().is_empty()) {
        Some(value) => PathBuf::from(value),
        None => std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .or_else(|| std::env::var_os("HOME"))
                    .map(|p| PathBuf::from(p).join(".codex"))
            })
            .ok_or_else(|| anyhow!("Codex data directory not found"))?,
    };
    let standalone = if root.is_file() && root.extension().is_some_and(|e| e == "jsonl") {
        Some(root.clone())
    } else {
        None
    };
    let source = root.clone();
    let root = if standalone.is_some() {
        root.parent()
            .ok_or_else(|| anyhow!("Source file has no parent directory"))?
            .to_path_buf()
    } else {
        root
    };
    if !root.is_dir() {
        return Err(anyhow!("Codex data directory or JSONL file does not exist"));
    }
    let mut catalog = Catalog {
        source,
        root: root.clone(),
        sessions: BTreeMap::new(),
        projects: vec![],
        history_db: db_file(&root, "thread_history_")?,
        warnings: vec![],
        cancelled: Arc::new(AtomicBool::new(false)),
    };
    let mut named_sessions = BTreeSet::new();
    if let Some(path) = if standalone.is_none() {
        db_file(&root, "state_")?
    } else {
        None
    } {
        let db = readonly(&path)?;
        if !has_table(&db, "threads")? {
            return Err(anyhow!(
                "Unsupported Codex state database: threads table missing"
            ));
        }
        for row in rows(&db, "threads")? {
            let Some(id) = text(&row, "id") else { continue };
            let name = text(&row, "name").filter(|name| !name.trim().is_empty());
            if name.is_some() {
                named_sessions.insert(id.clone());
            }
            let cwd = text(&row, "cwd");
            let files = text(&row, "rollout_path")
                .map(|p| {
                    let p = PathBuf::from(p);
                    if p.is_absolute() {
                        p
                    } else {
                        root.join(p)
                    }
                })
                .into_iter()
                .collect();
            catalog.sessions.insert(
                id.clone(),
                Candidate {
                    id,
                    title: name
                        .or_else(|| text(&row, "title"))
                        .unwrap_or_else(|| "Codex conversation".into()),
                    directory_exists: cwd.as_ref().is_some_and(|p| Path::new(p).is_dir()),
                    cwd,
                    project_id: text(&row, "project_id"),
                    created_at: timestamp(&row, "created_at_ms", "created_at"),
                    updated_at: timestamp(&row, "updated_at_ms", "updated_at"),
                    archived: row["archived"].as_i64() == Some(1),
                    model: text(&row, "model"),
                    reasoning_effort: text(&row, "reasoning_effort"),
                    imported: false,
                    files,
                    paginated: row["history_mode"] == "paginated",
                },
            );
        }
        if has_table(&db, "projects")? && has_table(&db, "project_roots")? {
            let roots = rows(&db, "project_roots")?;
            for row in rows(&db, "projects")? {
                let Some(id) = text(&row, "id") else { continue };
                let mut owned: Vec<_> = roots.iter().filter(|r| r["project_id"] == id).collect();
                owned.sort_by_key(|r| r["position"].as_i64().unwrap_or(0));
                catalog.projects.push(Project {
                    id,
                    name: text(&row, "name").unwrap_or_else(|| "Codex project".into()),
                    roots: owned.iter().filter_map(|r| text(r, "path")).collect(),
                    missing_roots: vec![],
                    session_ids: vec![],
                });
            }
        }
    }
    let mut paths = vec![];
    if let Some(path) = standalone.as_ref() {
        paths.push(path.clone());
    } else {
        discover(&root.join("sessions"), &mut paths)?;
        discover(&root.join("archived_sessions"), &mut paths)?;
    }
    paths.sort();
    for path in paths {
        let file = fs::File::open(&path)?;
        let mut line = String::new();
        BufReader::new(file).read_line(&mut line)?;
        let Ok(record) = serde_json::from_str::<Value>(&line) else {
            catalog
                .warnings
                .push(format!("Unreadable history header: {}", path.display()));
            continue;
        };
        let meta = if record["type"] == "session_meta" {
            &record["payload"]
        } else {
            &record
        };
        let Some(id) = text(meta, "id").or_else(|| text(meta, "session_id")) else {
            catalog.warnings.push(format!(
                "History header has no session ID: {}",
                path.display()
            ));
            continue;
        };
        if let Some(existing) = catalog.sessions.get_mut(&id) {
            if !existing.files.contains(&path) {
                existing.files.push(path);
            }
            continue;
        }
        let cwd = text(meta, "cwd");
        let created = text(meta, "timestamp")
            .or_else(|| text(&record, "timestamp"))
            .unwrap_or_else(|| timestamp(meta, "created_at_ms", "created_at"));
        catalog.sessions.insert(
            id.clone(),
            Candidate {
                id,
                title: text(meta, "title").unwrap_or_else(|| "Codex conversation".into()),
                directory_exists: cwd.as_ref().is_some_and(|p| Path::new(p).is_dir()),
                cwd,
                project_id: None,
                created_at: created.clone(),
                updated_at: created,
                archived: path.starts_with(root.join("archived_sessions")),
                model: text(meta, "model"),
                reasoning_effort: text(meta, "reasoning_effort"),
                imported: false,
                files: vec![path],
                paginated: meta["history_mode"] == "paginated",
            },
        );
    }
    let index = root.join("session_index.jsonl");
    if standalone.is_none() && index.is_file() {
        for line in BufReader::new(fs::File::open(index)?).lines() {
            if let Ok(row) = serde_json::from_str::<Value>(&line?) {
                if let Some(session) = text(&row, "id").and_then(|id| catalog.sessions.get_mut(&id))
                {
                    if !named_sessions.contains(&session.id) {
                        if let Some(title) = text(&row, "thread_name") {
                            session.title = title;
                        }
                    }
                }
            }
        }
    }
    let global_path = root.join(".codex-global-state.json");
    if standalone.is_none() && global_path.is_file() {
        let global: Value = serde_json::from_reader(fs::File::open(global_path)?)?;
        // Codex keeps legacy UI assignments after moving projects into SQLite.
        // Only its explicit mapping for this local source identifies aliases;
        // equal project names or a remote host's mapping do not.
        let aliases: BTreeMap<String, String> = global
            ["app-server-project-id-by-legacy-project-id-by-host"]
            .as_object()
            .and_then(|hosts| {
                hosts.iter().find_map(|(host, mapping)| {
                    host.strip_prefix("local:")
                        .filter(|home| super::same_path(home, &root.to_string_lossy()))
                        .and_then(|_| mapping.as_object())
                })
            })
            .into_iter()
            .flatten()
            .filter_map(|(legacy, current)| {
                current
                    .as_str()
                    .filter(|id| catalog.projects.iter().any(|p| p.id == *id))
                    .map(|current| (legacy.clone(), current.to_owned()))
            })
            .collect();
        for session in catalog.sessions.values_mut() {
            if let Some(current) = session.project_id.as_ref().and_then(|id| aliases.get(id)) {
                session.project_id = Some(current.clone());
            }
        }
        if let Some(projects) = global["local-projects"].as_object() {
            for (id, project) in projects {
                let id = aliases.get(id).unwrap_or(id);
                if !catalog.projects.iter().any(|p| &p.id == id) {
                    catalog.projects.push(Project {
                        id: id.clone(),
                        name: text(project, "name").unwrap_or_else(|| "Codex project".into()),
                        roots: project["rootPaths"]
                            .as_array()
                            .map(|a| {
                                a.iter()
                                    .filter_map(Value::as_str)
                                    .map(str::to_owned)
                                    .collect()
                            })
                            .unwrap_or_default(),
                        missing_roots: vec![],
                        session_ids: vec![],
                    });
                }
            }
        }
        if let Some(assignments) = global["thread-project-assignments"].as_object() {
            for (id, assignment) in assignments {
                if let Some(session) = catalog.sessions.get_mut(id) {
                    if session.project_id.is_none() {
                        session.project_id = text(assignment, "projectId")
                            .map(|id| aliases.get(&id).cloned().unwrap_or(id));
                    }
                }
            }
        }
    }
    for session in catalog.sessions.values_mut() {
        if session
            .project_id
            .as_ref()
            .is_none_or(|id| !catalog.projects.iter().any(|p| &p.id == id))
        {
            if let Some(cwd) = &session.cwd {
                let id = format!("cwd:{cwd}");
                session.project_id = Some(id.clone());
                if !catalog.projects.iter().any(|p| p.id == id) {
                    catalog.projects.push(Project {
                        id,
                        name: Path::new(cwd)
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| cwd.clone()),
                        roots: vec![cwd.clone()],
                        missing_roots: vec![],
                        session_ids: vec![],
                    });
                }
            }
        }
        if let Some(project) = catalog
            .projects
            .iter_mut()
            .find(|p| Some(&p.id) == session.project_id.as_ref())
        {
            project.session_ids.push(session.id.clone());
        }
    }
    catalog.sessions.retain(|id, _| {
        let valid = !id.is_empty()
            && id.len() <= 160
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'));
        if !valid {
            catalog.warnings.push(
                "A source session has an invalid storage identity and was not offered for import"
                    .into(),
            );
        }
        valid
    });
    for project in &mut catalog.projects {
        project
            .session_ids
            .retain(|id| catalog.sessions.contains_key(id));
        project.missing_roots = project
            .roots
            .iter()
            .filter(|p| !Path::new(p).is_dir())
            .cloned()
            .collect();
    }
    Ok(catalog)
}
