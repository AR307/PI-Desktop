use super::*;
use std::fs;

#[tokio::test]
async fn importing_two_forks_keeps_inherited_message_ids_session_scoped() {
    let source = tempfile::tempdir().unwrap().keep();
    let data = tempfile::tempdir().unwrap().keep();
    fs::create_dir(source.join("sessions")).unwrap();
    let base = [
        json!({"type":"session_meta","payload":{"id":"parent","cwd":source}}),
        json!({"type":"response_item","payload":{"id":"shared-message","type":"message","role":"user","content":"SHARED_BASE"}}),
        json!({"type":"event_msg","payload":{"type":"error","message":"Historical failure"}}),
    ];
    fs::write(
        source.join("sessions/parent.jsonl"),
        base.iter().map(|v| format!("{v}\n")).collect::<String>(),
    )
    .unwrap();
    for id in ["first-fork", "second-fork"] {
        let records = [
            json!({"type":"session_meta","payload":{"id":id,"cwd":source,"history_base":{"thread_id":"parent","end_ordinal_exclusive":3}}}),
            json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":id}}),
        ];
        fs::write(
            source.join(format!("sessions/{id}.jsonl")),
            records.iter().map(|v| format!("{v}\n")).collect::<String>(),
        )
        .unwrap();
    }
    let state = Arc::new(Mutex::new(AppState::open(&data).unwrap()));
    let scan = handle(
        state.clone(),
        "codex.import.scan",
        json!({"directory":source}),
    )
    .await
    .unwrap();
    for id in ["first-fork", "second-fork"] {
        let result = handle(
            state.clone(),
            "codex.import.run",
            json!({"scanId":scan["scanId"],"externalId":id,"runId":"forks"}),
        )
        .await
        .unwrap();
        assert_eq!(result["status"], "imported");
    }
}

#[test]
fn rotated_conversation_base_can_share_the_logical_thread_id() {
    let source = tempfile::tempdir().unwrap().keep();
    fs::create_dir(source.join("sessions")).unwrap();
    let id = "20000000-0000-4000-8000-000000000001";
    let segment = "20000000-0000-4000-8000-000000000002";
    let base = [
        json!({"type":"session_meta","payload":{"id":id}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":"ORIGINAL_BASE"}}),
    ];
    fs::write(
        source.join(format!("sessions/rollout-{id}.jsonl.zst")),
        zstd::stream::encode_all(
            base.iter()
                .map(|v| format!("{v}\n"))
                .collect::<String>()
                .as_bytes(),
            1,
        )
        .unwrap(),
    )
    .unwrap();
    let current = source.join(format!("sessions/rollout-{id}_{segment}.jsonl"));
    fs::write(&current, format!("{}\n{}\n",json!({"type":"session_meta","ordinal":2,"payload":{"id":id,"history_base":{"thread_id":id,"end_ordinal_exclusive":2}}}),json!({"type":"response_item","ordinal":3,"payload":{"type":"message","role":"assistant","content":"CURRENT_SEGMENT"}}))).unwrap();
    let db = rusqlite::Connection::open(source.join("state_5.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE threads(id TEXT, rollout_path TEXT)")
        .unwrap();
    db.execute(
        "INSERT INTO threads VALUES(?1,?2)",
        rusqlite::params![id, current.to_string_lossy()],
    )
    .unwrap();
    let catalog = catalog::scan(Some(source.to_string_lossy().into())).unwrap();
    let candidate = &catalog.sessions[id];
    let converted = convert::convert(
        &catalog,
        candidate,
        history::load(&catalog, candidate).unwrap(),
    )
    .unwrap();
    assert!(converted
        .messages
        .iter()
        .any(|m| m.content == "ORIGINAL_BASE"));
    assert!(converted
        .messages
        .iter()
        .any(|m| m.content == "CURRENT_SEGMENT"));
}

#[tokio::test]
async fn compressed_segment_chain_imports_native_history_and_never_executes_tools() {
    let source = tempfile::tempdir().unwrap().keep();
    let data = tempfile::tempdir().unwrap().keep();
    fs::create_dir(source.join("sessions")).unwrap();
    let id = "10000000-0000-4000-8000-000000000001";
    let segment = "10000000-0000-4000-8000-000000000002";
    let base = [
        json!({"type":"session_meta","ordinal":0,"payload":{"id":id,"session_id":id}}),
        json!({"type":"response_item","ordinal":1,"payload":{"type":"message","role":"user","content":"INHERITED_SOURCE_TASK"}}),
    ];
    let bytes = base.iter().map(|v| format!("{v}\n")).collect::<String>();
    fs::write(
        source.join(format!("sessions/rollout-{id}_{segment}.jsonl.zst")),
        zstd::stream::encode_all(bytes.as_bytes(), 1).unwrap(),
    )
    .unwrap();
    let current = [
        json!({"type":"session_meta","ordinal":2,"payload":{"id":id,"cwd":source,"history_base":{"thread_id":segment,"end_ordinal_exclusive":2}}}),
        json!({"type":"response_item","ordinal":3,"payload":{"type":"dynamicToolCall","id":"call","tool":"fixture_tool","arguments":{},"status":"failed","success":false,"contentItems":[{"type":"inputText","text":"Historical failure"}]}}),
        json!({"type":"response_item","ordinal":4,"payload":{"type":"message","role":"assistant","content":"LATEST_COMPLETE_REPLY"}}),
    ];
    fs::write(
        source.join(format!("sessions/rollout-{id}.jsonl.zst")),
        zstd::stream::encode_all(
            current
                .iter()
                .map(|v| format!("{v}\n"))
                .collect::<String>()
                .as_bytes(),
            1,
        )
        .unwrap(),
    )
    .unwrap();
    let catalog = catalog::scan(Some(source.to_string_lossy().into())).unwrap();
    assert_eq!(catalog.sessions.len(), 1);
    assert_eq!(catalog.segments.len(), 2);
    let candidate = &catalog.sessions[id];
    let converted = convert::convert(
        &catalog,
        candidate,
        history::load(&catalog, candidate).unwrap(),
    )
    .unwrap();
    assert!(converted.complete, "{:?}", converted.warnings);
    assert!(converted
        .messages
        .iter()
        .any(|m| m.content == "INHERITED_SOURCE_TASK"));
    assert!(converted
        .messages
        .iter()
        .any(|m| m.tool_name.as_deref() == Some("fixture_tool")
            && m.tool_status.as_deref() == Some("error")));
    assert!(!converted
        .warnings
        .iter()
        .any(|w| w.contains("Unsupported history item")));
    let context = serde_json::to_string(&converted.context).unwrap();
    assert!(context.contains("INHERITED_SOURCE_TASK"));
    assert!(context.contains("LATEST_COMPLETE_REPLY"));
    assert!(converted.context.iter().all(|m| m["role"] != "toolResult"));
    let state = Arc::new(Mutex::new(AppState::open(&data).unwrap()));
    let scan = handle(
        state.clone(),
        "codex.import.scan",
        json!({"directory":source}),
    )
    .await
    .unwrap();
    let result = handle(
        state.clone(),
        "codex.import.run",
        json!({"scanId":scan["scanId"],"externalId":id,"runId":"compressed"}),
    )
    .await
    .unwrap();
    assert_eq!(result["status"], "imported");
    assert_eq!(result["context"], "restored");
}

#[tokio::test]
async fn partial_context_requires_consent_and_retains_usable_checkpoint() {
    let source = tempfile::tempdir().unwrap().keep();
    let data = tempfile::tempdir().unwrap().keep();
    fs::create_dir(source.join("sessions")).unwrap();
    let records = [
        json!({"type":"session_meta","payload":{"id":"partial","cwd":source}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":"VISIBLE_HISTORY"}}),
        json!({"type":"compacted","payload":{"replacement_history":[{"type":"message","role":"user","content":"RECOVERABLE_CONTEXT"}],"retained_context":{"user_messages_incomplete":true}}}),
        json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":"LATEST_REPLY"}}),
    ];
    fs::write(
        source.join("sessions/partial.jsonl"),
        records.iter().map(|v| format!("{v}\n")).collect::<String>(),
    )
    .unwrap();
    let state = Arc::new(Mutex::new(AppState::open(&data).unwrap()));
    let scan = handle(
        state.clone(),
        "codex.import.scan",
        json!({"directory":source}),
    )
    .await
    .unwrap();
    let mut input = json!({"scanId":scan["scanId"],"externalId":"partial","runId":"partial"});
    let preview = handle(state.clone(), "codex.import.run", input.clone())
        .await
        .unwrap();
    assert_eq!(preview["status"], "needsConfirmation");
    assert!(preview["availableContextMessages"].as_u64().unwrap() > 0);
    assert!(
        sessions::get_session_summary(&state.lock().await.db, "import-codex-partial")
            .unwrap()
            .is_none()
    );
    input["allowPartialContext"] = json!(true);
    let result = handle(state.clone(), "codex.import.run", input)
        .await
        .unwrap();
    assert_eq!(result["status"], "imported");
    assert_eq!(result["context"], "partial");
    let transcripts = walkdir::WalkDir::new(&data)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x == "jsonl"))
        .map(|e| fs::read_to_string(e.path()).unwrap())
        .collect::<String>();
    assert!(transcripts.contains("RECOVERABLE_CONTEXT"));
    assert!(transcripts.contains("LATEST_REPLY"));
    assert!(transcripts.contains("this history is incomplete"));
}
