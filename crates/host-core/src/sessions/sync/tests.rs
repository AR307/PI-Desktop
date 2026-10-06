use super::*;

fn message(id: &str, role: &str, content: &str) -> UiMessage {
    serde_json::from_value(json!({
        "id": id, "role": role, "content": content, "status": "complete",
        "createdAt": "2026-10-06T00:00:00Z"
    }))
    .unwrap()
}

fn apply(page: SessionChangesPage, cache: &mut HashMap<String, (i64, UiMessage)>) -> i64 {
    for change in page.changes {
        match change {
            SessionChange::Upsert {
                message_id,
                sequence,
                message,
                ..
            } => {
                cache.insert(message_id, (sequence, *message));
            }
            SessionChange::Delete { message_id, .. } => {
                cache.remove(&message_id);
            }
        }
    }
    page.revision
}

#[test]
fn cached_history_over_500_messages_survives_restart_and_reconciles_only_changes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    let db = Database::open(&path).unwrap();
    let session = create_session(&db, None, None, None, None, None).unwrap();
    for index in 0..610 {
        append_message(
            &db,
            &session.id,
            &message(&format!("m{index}"), "user", &format!("Message {index}")),
            None,
        )
        .unwrap();
    }
    let snapshot = get_session(&db, &session.id).unwrap().unwrap();
    let mut cache = snapshot
        .messages
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, message)| (message.id.clone(), (index as i64, message)))
        .collect::<HashMap<_, _>>();
    let saved_revision = snapshot.sync_revision;
    drop(db);

    let db = Database::open(&path).unwrap();
    let mut edited = snapshot.messages;
    edited[300].content = "Corrected after the phone went offline".into();
    edited.truncate(609);
    replace_messages(&db, &session.id, &edited).unwrap();
    append_message(
        &db,
        &session.id,
        &message("new-answer", "assistant", "New answer"),
        None,
    )
    .unwrap();
    let mut revision = saved_revision;
    let mut transferred = 0;
    loop {
        let page = list_session_changes(&db, &session.id, revision, 2, None).unwrap();
        transferred += page.changes.len();
        let has_more = page.has_more;
        revision = apply(page, &mut cache);
        if !has_more {
            break;
        }
    }
    assert_eq!(transferred, 3, "unchanged history must not be sent again");
    assert_eq!(cache.len(), 610);
    assert!(!cache.contains_key("m609"));
    assert_eq!(cache["m300"].1.content, edited[300].content);
    assert_eq!(cache["new-answer"].1.content, "New answer");
    assert!(list_session_changes(&db, &session.id, revision, 50, None)
        .unwrap()
        .changes
        .is_empty());
    let detail = get_session(&db, &session.id).unwrap().unwrap();
    assert_eq!(detail.sync_revision, revision);
}

#[test]
fn changes_during_paging_are_not_skipped_and_deleted_messages_do_not_revive() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open_in_dir(dir.path()).unwrap();
    let session = create_session(&db, None, None, None, None, None).unwrap();
    for id in ["one", "two", "three"] {
        append_message(&db, &session.id, &message(id, "assistant", id), None).unwrap();
    }
    let first = list_session_changes(&db, &session.id, 0, 1, None).unwrap();
    assert!(first.has_more);
    let mut cache = HashMap::new();
    let mut revision = apply(first, &mut cache);
    let mut history = get_session(&db, &session.id).unwrap().unwrap().messages;
    history[0].content = "Updated while paging".into();
    history.remove(1);
    replace_messages(&db, &session.id, &history).unwrap();
    loop {
        let page = list_session_changes(&db, &session.id, revision, 1, None).unwrap();
        let more = page.has_more;
        revision = apply(page, &mut cache);
        if !more {
            break;
        }
    }
    assert_eq!(cache.len(), 2);
    assert_eq!(cache["one"].1.content, "Updated while paging");
    assert_eq!(cache["three"].0, 1);
    assert!(!cache.contains_key("two"));
}

#[test]
fn terminal_stream_and_subagent_results_update_the_original_cached_rows() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open_in_dir(dir.path()).unwrap();
    let session = create_session(&db, None, None, None, None, None).unwrap();
    let mut reply = message("reply", "assistant", "partial");
    reply.status = Some("streaming".into());
    append_message(&db, &session.id, &reply, None).unwrap();
    let mut task: UiMessage = serde_json::from_value(json!({
        "id": "task", "role": "tool", "content": "started", "status": "complete",
        "createdAt": "2026-10-06T00:00:00Z", "toolName": "Task", "toolCallId": "task",
        "toolResult": {"details": {"delegationId": "child", "status": "running"}}
    }))
    .unwrap();
    append_message(&db, &session.id, &task, None).unwrap();
    let position = session_sync_revision(&db, &session.id).unwrap();
    reply.status = Some("complete".into());
    reply.content = "Complete response".into();
    append_message(&db, &session.id, &reply, None).unwrap();
    task.tool_result = Some(
        json!({"details": {"delegationId": "child", "status": "completed", "result": "done"}}),
    );
    append_message(&db, &session.id, &task, None).unwrap();
    let page = list_session_changes(&db, &session.id, position, 50, None).unwrap();
    assert_eq!(page.changes.len(), 2);
    let mut cache = HashMap::new();
    let revision = apply(page, &mut cache);
    assert_eq!(cache["reply"].1.content, "Complete response");
    assert_eq!(cache["task"].1.tool_result, task.tool_result);
    append_message(&db, &session.id, &reply, None).unwrap();
    assert_eq!(
        session_sync_revision(&db, &session.id).unwrap(),
        revision,
        "outbox replay remains idempotent"
    );
}

#[test]
fn display_caps_do_not_change_the_canonical_message_or_sync_position() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open_in_dir(dir.path()).unwrap();
    let session = create_session(&db, None, None, None, None, None).unwrap();
    append_message(
        &db,
        &session.id,
        &message("large", "assistant", &"x".repeat(5000)),
        None,
    )
    .unwrap();
    let page = list_session_changes(&db, &session.id, 0, 50, Some(128)).unwrap();
    let mut cache = HashMap::new();
    apply(page, &mut cache);
    assert!(cache["large"].1.content.len() < 300);
    assert_eq!(
        get_session(&db, &session.id).unwrap().unwrap().messages[0]
            .content
            .len(),
        5000
    );
    assert!(list_session_changes(&db, &session.id, 2, 50, None).is_err());
    assert!(list_session_changes(&db, &session.id, -1, 50, None).is_err());
}
