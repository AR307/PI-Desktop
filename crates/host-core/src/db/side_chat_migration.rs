use super::*;

pub(crate) const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS side_chats (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  parent_session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE RESTRICT,
  workspace_path TEXT NOT NULL
) WITHOUT ROWID;
"#;

pub(crate) fn migrate(conn: &Connection, path: &Path) -> Result<()> {
    let backup = create_migration_backup(conn, path, 25)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(SCHEMA)?;
    let has_quotes: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('turn_queue') WHERE name = 'quotes_json')",
        [],
        |row| row.get(0),
    )?;
    if !has_quotes {
        tx.execute_batch("ALTER TABLE turn_queue ADD COLUMN quotes_json TEXT;")?;
    }
    tx.pragma_update(None, "user_version", 26i64)?;
    tx.commit()
        .with_context(|| format!("migrate side chats; backup {} remains", backup.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrades_v25_without_rewriting_existing_history_or_queue() {
        let dir = std::env::temp_dir().join(format!("pi-side-migration-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions(id TEXT PRIMARY KEY, title TEXT);
             CREATE TABLE turn_queue(id TEXT PRIMARY KEY, content TEXT);
             INSERT INTO sessions VALUES ('parent', 'Keep existing title');
             INSERT INTO turn_queue VALUES ('waiting', 'Keep queued input');
             PRAGMA user_version = 25;",
        )
        .unwrap();
        migrate(&conn, &path).unwrap();
        assert_eq!(
            conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            26
        );
        assert_eq!(
            conn.query_row("SELECT title FROM sessions", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Keep existing title"
        );
        assert_eq!(
            conn.query_row("SELECT content FROM turn_queue", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "Keep queued input"
        );
        assert!(conn
            .query_row("SELECT quotes_json FROM turn_queue", [], |r| r
                .get::<_, Option<String>>(0))
            .unwrap()
            .is_none());
    }
}
