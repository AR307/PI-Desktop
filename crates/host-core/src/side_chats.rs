//! Temporary sessions have ordinary execution identities, never ordinary history.
use crate::{db::Database, scratch, sessions, transcripts};
use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::json;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideChat {
    pub session: sessions::SessionSummary,
    pub parent_session_id: String,
    pub workspace_path: String,
    pub created: bool,
}

pub fn workspace(db: &Database, id: &str) -> Result<Option<String>> {
    Ok(db
        .conn()
        .query_row(
            "SELECT workspace_path FROM side_chats WHERE session_id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?)
}

pub fn ids(db: &Database) -> Result<Vec<String>> {
    Ok(db
        .conn()
        .prepare("SELECT session_id FROM side_chats")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn open(db: &Database, parent_id: &str, workspace_path: &str) -> Result<SideChat> {
    if parent_id.starts_with("side-") {
        return Err(anyhow!("Side chats cannot create nested side chats"));
    }
    let parent = sessions::session_summary(db, parent_id)?
        .ok_or_else(|| anyhow!("Parent session not found"))?;
    let existing: Option<String> = db
        .conn()
        .query_row(
            "SELECT session_id FROM side_chats WHERE parent_session_id = ?1",
            [parent_id],
            |row| row.get(0),
        )
        .optional()?;
    let created = existing.is_none();
    let session = if let Some(id) = existing {
        sessions::session_summary(db, &id)?.ok_or_else(|| anyhow!("Side chat session not found"))?
    } else {
        let id = format!("side-{}", uuid::Uuid::new_v4());
        let permission_mode = crate::session_collaboration::effective_mode(db, parent_id)?;
        let tx = db.conn().unchecked_transaction()?;
        tx.execute("INSERT INTO sessions (id, title, project_id, provider_id, model_id, mode, thinking_level, permission_mode, title_source, created_at, updated_at) SELECT ?1, 'Side chat', project_id, provider_id, model_id, mode, thinking_level, permission_mode, 'manual', ?3, ?3 FROM sessions WHERE id = ?2", params![id, parent_id, crate::db::now_ms()])?;
        tx.execute("INSERT INTO side_chats(session_id, parent_session_id, workspace_path) VALUES (?1, ?2, ?3)", params![id, parent_id, workspace_path])?;
        tx.execute(
            "UPDATE sessions SET permission_mode = ?2 WHERE id = ?1",
            params![id, permission_mode],
        )?;
        db.kv_set("app", &format!("session-fast:{id}"), &json!(parent.fast))?;
        db.kv_set("app", &format!("session-ultra:{id}"), &json!(parent.ultra))?;
        tx.commit()?;
        sessions::session_summary(db, &id)?.ok_or_else(|| anyhow!("Side chat session not found"))?
    };
    Ok(SideChat {
        workspace_path: workspace(db, &session.id)?
            .ok_or_else(|| anyhow!("Side chat workspace missing"))?,
        session,
        parent_session_id: parent_id.into(),
        created,
    })
}

/// Exact app-owned files only. Electron moves these to the OS recycle bin.
pub fn cleanup_paths(db: &Database, id: &str) -> Result<Vec<String>> {
    if workspace(db, id)?.is_none() {
        return Err(anyhow!("Not a temporary side chat"));
    }
    let transcript = transcripts::transcript_path(db.data_dir(), id)?;
    let inflight = transcripts::inflight_path(db.data_dir(), id)?;
    let mut paths = vec![
        transcript.with_extension("jsonl.tmp"),
        transcript.with_extension("jsonl.layout"),
        transcript.with_extension("jsonl.layout.tmp"),
        transcript.with_extension("layout.tmp"),
        transcript,
        transcripts::revisions_path(db.data_dir(), id)?,
        inflight.with_extension("json.tmp"),
        inflight,
    ];
    if let Some(scratch) = scratch::session_dir(db.data_dir(), id) {
        paths.push(scratch);
    }
    Ok(paths
        .into_iter()
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

pub fn close(db: &Database, id: &str) -> Result<()> {
    if workspace(db, id)?.is_none() {
        return Err(anyhow!("Not a temporary side chat"));
    }
    if !cleanup_paths(db, id)?.is_empty() {
        return Err(anyhow!("Recycle side chat files before closing"));
    }
    let tx = db.conn().unchecked_transaction()?;
    tx.execute(
        "DELETE FROM kv WHERE ns = 'app' AND key IN (?1, ?2)",
        [format!("session-fast:{id}"), format!("session-ultra:{id}")],
    )?;
    tx.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn side_chat_is_unique_hidden_and_cannot_be_resurrected_after_close() {
        let dir = std::env::temp_dir().join(format!("pi-side-chat-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = Database::open(&dir.join("test.sqlite")).unwrap();
        let parent = sessions::create_session_with_options(
            &db,
            sessions::SessionCreateOptions {
                title: Some("Parent".into()),
                mode: Some("agent".into()),
                provider_id: Some("provider".into()),
                model_id: Some("model".into()),
                thinking_level: Some("high".into()),
                permission_mode: Some("inherit".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let workspace = dir.to_string_lossy().into_owned();
        let first = open(&db, &parent.id, &workspace).unwrap();
        assert!(first.created);
        assert_eq!(first.session.model_id, parent.model_id);
        assert_eq!(first.session.thinking_level, parent.thinking_level);
        assert_eq!(first.session.permission_mode, "ask");
        let second = open(&db, &parent.id, &workspace).unwrap();
        assert!(!second.created);
        assert_eq!(first.session.id, second.session.id);
        assert!(sessions::list_sessions(&db)
            .unwrap()
            .iter()
            .all(|s| s.id != first.session.id));
        assert!(db
            .conn()
            .execute("DELETE FROM sessions WHERE id = ?1", [&parent.id])
            .is_err());
        assert!(sessions::delete_session(&db, &first.session.id).is_err());
        let msg: sessions::UiMessage = serde_json::from_value(json!({
            "id": "child-message", "role": "user", "content": "Child question",
            "createdAt": "2026-10-18T00:00:00Z",
            "quotes": [{ "sessionId": parent.id, "messageId": "source", "text": "中文 source" }]
        }))
        .unwrap();
        sessions::append_message(&db, &first.session.id, &msg, None).unwrap();
        let restored = sessions::get_session(&db, &first.session.id)
            .unwrap()
            .unwrap();
        assert_eq!(restored.messages[0].quotes, msg.quotes);
        assert!(close(&db, &first.session.id).is_err());
        // Simulate Electron's move to a recycle location, never delete fixtures.
        let recycled = dir.join("recycled");
        std::fs::create_dir_all(&recycled).unwrap();
        for (index, path) in cleanup_paths(&db, &first.session.id)
            .unwrap()
            .into_iter()
            .enumerate()
        {
            assert!(!std::path::Path::new(&path).ends_with("test.sqlite"));
            std::fs::rename(&path, recycled.join(index.to_string())).unwrap();
        }
        close(&db, &first.session.id).unwrap();
        assert!(ids(&db).unwrap().is_empty());
        assert!(sessions::append_message(&db, &first.session.id, &msg, None).is_err());
        assert!(sessions::get_session(&db, &parent.id).unwrap().is_some());
    }
}
