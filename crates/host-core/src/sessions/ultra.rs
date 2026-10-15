#[cfg(test)]
mod tests {
    use crate::{db::Database, sessions::*};

    #[test]
    fn ultra_is_session_scoped_durable_and_resets_on_selection_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ultra.sqlite");
        let db = Database::open(&path).unwrap();
        let session = create_session_with_thinking(
            &db,
            None,
            Some("agent".into()),
            None,
            Some("a".into()),
            None,
            Some("low".into()),
        )
        .unwrap();
        assert!(!session.ultra);
        let saved = configure_session_with_thinking(
            &db,
            &session.id,
            "agent",
            None,
            None,
            None,
            None,
            None,
            Some(true),
        )
        .unwrap()
        .unwrap();
        assert!(saved.ultra);
        assert_eq!(saved.thinking_level, "low");
        rename_session(&db, &session.id, "Ultra search session").unwrap();
        let search = crate::session_search::search(&db, "Ultra search", 0, 50).unwrap();
        assert_eq!(search.hits.len(), 1);
        assert!(search.hits[0].session.ultra);
        drop(db);
        let db = Database::open(&path).unwrap();
        assert!(
            get_session_summary(&db, &session.id)
                .unwrap()
                .unwrap()
                .ultra
        );
        let next = configure_session_with_thinking(
            &db,
            &session.id,
            "agent",
            None,
            Some("b"),
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap();
        assert!(!next.ultra);
        assert_eq!(next.thinking_level, "low");
        let explicit = configure_session_with_thinking(
            &db,
            &session.id,
            "agent",
            None,
            None,
            None,
            None,
            None,
            Some(true),
        )
        .unwrap()
        .unwrap();
        assert!(explicit.ultra);
        let other = create_session(&db, None, None, None, None, None).unwrap();
        assert!(!other.ultra);
    }
}
