use super::*;

/// This is a change index, not a second transcript. Each message keeps only its
/// latest revision or deletion marker; payloads are read from canonical JSONL.
pub(crate) const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS session_sync_state (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS session_sync_changes (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('upsert', 'delete')),
  PRIMARY KEY (session_id, message_id)
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_sync_changes_revision
  ON session_sync_changes(session_id, revision);
"#;

pub(crate) fn migrate(conn: &Connection, path: &Path) -> Result<()> {
    let backup = create_migration_backup(conn, path, 23)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(SCHEMA)?;
    tx.execute_batch(
        "DROP INDEX IF EXISTS idx_sessions_updated;
        CREATE INDEX IF NOT EXISTS idx_sessions_updated_id ON sessions(updated_at DESC, id DESC);",
    )?;
    // Existing transcripts start at zero. A first history page captures zero;
    // only later writes need change entries, so upgrading never copies bodies.
    tx.pragma_update(None, "user_version", 24i64)?;
    tx.commit().with_context(|| {
        format!(
            "commit schema v23 to v24 migration; backup {} remains",
            backup.display()
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrades_fork_v22_without_resetting_mobile_revisions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fork.sqlite");
        let db = Database::open(&path).unwrap();
        let session =
            crate::sessions::create_session(&db, Some("My title".into()), None, None, None, None)
                .unwrap();
        let message: crate::sessions::UiMessage = serde_json::from_value(serde_json::json!({
            "id": "retained", "role": "user", "content": "Keep my history",
            "createdAt": "2026-10-06T00:00:00Z"
        }))
        .unwrap();
        crate::sessions::append_message(&db, &session.id, &message, None).unwrap();
        let before = crate::sessions::session_sync_revision(&db, &session.id).unwrap();
        db.conn()
            .execute_batch(
                "ALTER TABLE sessions DROP COLUMN title_source;
            DROP INDEX idx_sessions_updated_id;
            CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
            PRAGMA user_version = 22;",
            )
            .unwrap();
        drop(db);
        let db = Database::open(&path).unwrap();
        let detail = crate::sessions::get_session(&db, &session.id)
            .unwrap()
            .unwrap();
        assert_eq!(detail.messages.len(), 1);
        assert_eq!(detail.messages[0].content, "Keep my history");
        assert_eq!(detail.sync_revision, before);
        let title_source: String = db
            .conn()
            .query_row(
                "SELECT title_source FROM sessions WHERE id = ?1",
                [&session.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title_source, "manual");
        let changes = crate::sessions::list_session_changes(&db, &session.id, 0, 50, None).unwrap();
        assert_eq!(changes.changes.len(), 1);
        let indexes: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'idx_sessions_updated_id'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexes, 1);
    }

    #[test]
    fn upgrades_upstream_v22_and_v23_with_empty_mobile_index() {
        for version in [22, 23] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("upstream.sqlite");
            let db = Database::open(&path).unwrap();
            let session =
                crate::sessions::create_session(&db, None, None, None, None, None).unwrap();
            db.conn()
                .execute_batch("DROP TABLE session_sync_changes; DROP TABLE session_sync_state;")
                .unwrap();
            if version == 22 {
                db.conn()
                    .execute_batch("ALTER TABLE sessions DROP COLUMN title_source;")
                    .unwrap();
            }
            db.conn()
                .pragma_update(None, "user_version", version)
                .unwrap();
            drop(db);
            let db = Database::open(&path).unwrap();
            assert_eq!(
                crate::sessions::session_sync_revision(&db, &session.id).unwrap(),
                0
            );
            let version: i64 = db
                .conn()
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .unwrap();
            assert_eq!(version, 24);
        }
    }

    #[test]
    fn upgrade_preserves_existing_history_and_starts_changes_after_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi.sqlite");
        let db = Database::open(&path).unwrap();
        let session = crate::sessions::create_session(&db, None, None, None, None, None).unwrap();
        let message: crate::sessions::UiMessage = serde_json::from_value(serde_json::json!({
            "id": "before-upgrade", "role": "user", "content": "Keep my history",
            "createdAt": "2026-10-06T00:00:00Z"
        }))
        .unwrap();
        crate::sessions::append_message(&db, &session.id, &message, None).unwrap();
        db.conn()
            .execute_batch(
                "DROP TABLE session_sync_changes; DROP TABLE session_sync_state;
             PRAGMA user_version = 21;",
            )
            .unwrap();
        drop(db);

        let db = Database::open(&path).unwrap();
        let detail = crate::sessions::get_session(&db, &session.id)
            .unwrap()
            .unwrap();
        assert_eq!(detail.messages.len(), 1);
        assert_eq!(detail.messages[0].content, "Keep my history");
        assert_eq!(detail.sync_revision, 0);
        let mut next = message;
        next.id = "after-upgrade".into();
        crate::sessions::append_message(&db, &session.id, &next, None).unwrap();
        let page = crate::sessions::list_session_changes(&db, &session.id, 0, 50, None).unwrap();
        assert_eq!(page.revision, 1);
        assert_eq!(page.changes.len(), 1);
        assert_eq!(
            db.conn()
                .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            24
        );
    }
}
