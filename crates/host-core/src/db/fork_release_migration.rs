use super::*;

/// Released fork schemas 25/26 also carried mobile deltas and side chats.
/// Converge those databases with upstream 29 without rewriting transcripts.
pub(crate) fn migrate(conn: &Connection, path: &Path) -> Result<()> {
    let backup = create_migration_backup(conn, path, 29)?;
    let tx = conn.unchecked_transaction()?;
    let has_discovery: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('models') WHERE name = 'discovery_state')",
        [],
        |row| row.get(0),
    )?;
    if !has_discovery {
        tx.execute_batch(
            "ALTER TABLE models ADD COLUMN discovery_state TEXT
             CHECK (discovery_state IN ('published', 'unlisted'));
             UPDATE models SET discovery_state = 'published' WHERE source = 'discovered';",
        )?;
    }
    super::worktree_migration::ensure_worktree_schema(&tx)?;
    tx.execute_batch(super::session_sync_migration::SCHEMA)?;
    tx.execute_batch(super::side_chat_migration::SCHEMA)?;
    tx.execute_batch(
        "DROP INDEX IF EXISTS idx_sessions_updated;
        CREATE INDEX IF NOT EXISTS idx_sessions_updated_id ON sessions(updated_at DESC, id DESC);",
    )?;
    let has_quotes: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('turn_queue') WHERE name = 'quotes_json')",
        [],
        |row| row.get(0),
    )?;
    if !has_quotes {
        tx.execute_batch("ALTER TABLE turn_queue ADD COLUMN quotes_json TEXT;")?;
    }
    tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    tx.commit().with_context(|| {
        format!(
            "converge released schemas; backup {} remains",
            backup.display()
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn released_fork_26_keeps_conversation_queue_and_mobile_revisions() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("pi.sqlite");
        let db = Database::open(&path).unwrap();
        let session = crate::sessions::create_session(
            &db,
            Some("Keep my conversation".into()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let message = serde_json::from_value(serde_json::json!({
            "id": "retained", "role": "user", "content": "Keep my history",
            "createdAt": "2026-10-29T00:00:00Z"
        }))
        .unwrap();
        crate::sessions::append_message(&db, &session.id, &message, None).unwrap();
        let before = crate::sessions::session_sync_revision(&db, &session.id).unwrap();
        db.conn().execute("INSERT INTO turn_queue(id,session_id,principal,input_hash,content,permission_mode,position,created_at,quotes_json) VALUES ('queued',?1,'local','fixture','Keep queued input','ask',0,1,'[]')", [&session.id]).unwrap();
        db.conn()
            .execute_batch(
                "ALTER TABLE models DROP COLUMN discovery_state;
            ALTER TABLE sessions DROP COLUMN fast_mode;
            ALTER TABLE sessions DROP COLUMN mode_snapshot_hash;
            PRAGMA user_version=26;",
            )
            .unwrap();
        drop(db);

        let db = Database::open(&path).unwrap();
        let restored = crate::sessions::get_session(&db, &session.id)
            .unwrap()
            .unwrap();
        assert_eq!(restored.summary.title, "Keep my conversation");
        assert_eq!(restored.messages[0].content, "Keep my history");
        assert_eq!(restored.sync_revision, before);
        assert_eq!(
            db.conn()
                .query_row(
                    "SELECT content FROM turn_queue WHERE id='queued'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "Keep queued input"
        );
        assert_eq!(
            db.conn()
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('models') WHERE name='discovery_state'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        assert_eq!(
            db.conn()
                .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
    }
}
