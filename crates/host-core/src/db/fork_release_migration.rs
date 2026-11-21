use super::*;

/// Released fork schemas 25/26 also carried mobile deltas and side chats.
/// Converge fork additions before continuing the upstream migration chain.
pub(crate) fn migrate(conn: &Connection, path: &Path) -> Result<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let backup = create_migration_backup(conn, path, version)?;
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
    // Fork 0.21.2 used version 30 without upstream's elapsed/Goal columns.
    if version == 30 {
        super::mode_run_elapsed_migration::initialize(&tx)?;
    }
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
    fn released_fork_30_adds_upstream_goal_columns_without_losing_quoted_queue() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("pi.sqlite");
        let db = Database::open(&path).unwrap();
        let session = crate::sessions::create_session(
            &db,
            Some("Keep fork 30".into()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let message = serde_json::from_value(serde_json::json!({
            "id": "fork30-message", "role": "user", "content": "Keep existing history",
            "createdAt": "2026-11-11T00:00:00Z"
        }))
        .unwrap();
        crate::sessions::append_message(&db, &session.id, &message, None).unwrap();
        let revision = crate::sessions::session_sync_revision(&db, &session.id).unwrap();
        let queue: crate::turn_queue::QueuedTurnInput = serde_json::from_value(serde_json::json!({
            "sessionId": session.id, "principal": "phone", "inputHash": "fixture",
            "content": "Continue with this quote", "permissionMode": "ask",
            "quotes": [{ "sessionId": session.id, "messageId": "fork30-message", "role": "user", "text": "Keep existing history" }]
        })).unwrap();
        crate::turn_queue::push(&db, queue).unwrap();
        db.conn()
            .execute_batch(
                "ALTER TABLE mode_runs DROP COLUMN elapsed_ms;
             ALTER TABLE mode_runs DROP COLUMN active_since_ms;
             ALTER TABLE mode_runs DROP COLUMN completion_report_json;
             ALTER TABLE turn_queue DROP COLUMN start_goal;
             ALTER TABLE models DROP COLUMN reported_context_window;
             PRAGMA user_version=30;",
            )
            .unwrap();
        drop(db);

        let db = Database::open(&path).unwrap();
        let restored = crate::sessions::get_session(&db, &session.id)
            .unwrap()
            .unwrap();
        assert_eq!(restored.messages[0].content, "Keep existing history");
        assert_eq!(restored.sync_revision, revision);
        let queue = crate::turn_queue::list(&db, Some(&session.id)).unwrap();
        assert_eq!(
            queue[0].quotes.as_ref().unwrap()[0].text,
            "Keep existing history"
        );
        assert!(!queue[0].start_goal);
        assert!(db
            .conn()
            .prepare("SELECT elapsed_ms, active_since_ms, completion_report_json FROM mode_runs")
            .is_ok());
        assert!(db
            .conn()
            .prepare("SELECT reported_context_window FROM models")
            .is_ok());
        assert_eq!(
            db.conn()
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        drop(db);
        let reopened = Database::open(&path).unwrap();
        assert_eq!(
            crate::turn_queue::list(&reopened, Some(&session.id)).unwrap(),
            queue
        );
    }

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
