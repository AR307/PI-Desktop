use super::*;
use std::fs;

fn fixture_source(records: Vec<Value>) -> (std::path::PathBuf, catalog::Catalog) {
    let path = tempfile::tempdir().unwrap().keep();
    fs::create_dir(path.join("sessions")).unwrap();
    let mut raw = format!(
        "{}\n",
        json!({"type":"session_meta","payload":{"id":"fixture","cwd":path,"timestamp":"2026-10-25T00:00:00Z"}})
    );
    for record in records {
        raw.push_str(&format!("{record}\n"));
    }
    fs::write(path.join("sessions/fixture.jsonl"), raw).unwrap();
    let catalog = catalog::scan(Some(path.to_string_lossy().into())).unwrap();
    (path, catalog)
}
fn message(role: &str, body: &str) -> Value {
    json!({"type":"response_item","payload":{"type":"message","role":role,"content":[{"type":"input_text","text":body}]}})
}

#[test]
fn persisted_ordinals_bound_forks_and_opaque_compaction_requires_confirmation() {
    let (path, _) = fixture_source(vec![message("user", "original")]);
    let parent = [
        json!({"type":"session_meta","ordinal":50,"payload":{"id":"fixture","cwd":path}}),
        json!({"ordinal":51,"type":"response_item","payload":message("user","keep ordinal 51")["payload"]}),
        json!({"ordinal":70,"type":"response_item","payload":message("assistant","exclude ordinal 70")["payload"]}),
    ];
    fs::write(
        path.join("sessions/fixture.jsonl"),
        parent.iter().map(|r| format!("{r}\n")).collect::<String>(),
    )
    .unwrap();
    let child = [
        json!({"type":"session_meta","payload":{"id":"child","cwd":path,"history_base":{"thread_id":"fixture","end_ordinal_exclusive":52}}}),
        message("user", "child"),
        json!({"type":"compacted","payload":{"replacement_history":[message("user","retained question")["payload"],{"type":"compaction","encrypted_content":"opaque"}]}}),
    ];
    fs::write(
        path.join("sessions/child.jsonl"),
        child.iter().map(|r| format!("{r}\n")).collect::<String>(),
    )
    .unwrap();
    let catalog = catalog::scan(Some(path.to_string_lossy().into())).unwrap();
    let candidate = &catalog.sessions["child"];
    let converted = convert::convert(
        &catalog,
        candidate,
        history::load(&catalog, candidate).unwrap(),
    )
    .unwrap();
    assert!(converted
        .messages
        .iter()
        .any(|m| m.content == "keep ordinal 51"));
    assert!(!converted
        .messages
        .iter()
        .any(|m| m.content.contains("exclude ordinal 70")));
    assert!(!converted.complete);
}

#[test]
fn mixed_fork_projection_preserves_chronology_and_missing_attachments_remain_visible() {
    let (path, _) = fixture_source(vec![
        message("user", "parent first"),
        message("assistant", "parent second"),
    ]);
    let child = [
        json!({"type":"session_meta","payload":{"id":"child","cwd":path,"history_mode":"paginated","history_base":{"thread_id":"fixture","end_ordinal_exclusive":3}}}),
        message("user", "child third"),
        message("assistant", "child fourth"),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"localImage","path":"missing.png"}]}}),
    ];
    fs::write(
        path.join("sessions/child.jsonl"),
        child.iter().map(|r| format!("{r}\n")).collect::<String>(),
    )
    .unwrap();
    let db = rusqlite::Connection::open(path.join("thread_history_1.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE thread_items(thread_id TEXT,item_id TEXT,rollout_ordinal INTEGER,created_at_ms INTEGER,item_json TEXT,updated_at_ordinal INTEGER); CREATE TABLE thread_history_projection_state(thread_id TEXT,next_rollout_ordinal INTEGER); INSERT INTO thread_history_projection_state VALUES('child',2);").unwrap();
    db.execute("INSERT INTO thread_items VALUES('child','projected',1,0,?1,1)", [json!({"type":"userMessage","id":"projected","content":[{"type":"text","text":"child third"}]}).to_string()]).unwrap();
    drop(db);
    let catalog = catalog::scan(Some(path.to_string_lossy().into())).unwrap();
    let candidate = &catalog.sessions["child"];
    let converted = convert::convert(
        &catalog,
        candidate,
        history::load(&catalog, candidate).unwrap(),
    )
    .unwrap();
    assert_eq!(
        converted.messages[..4]
            .iter()
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>(),
        [
            "parent first",
            "parent second",
            "child third",
            "child fourth"
        ]
    );
    assert!(!converted.complete);
    assert!(converted
        .messages
        .last()
        .unwrap()
        .content
        .contains("Attachment import warning"));
}

#[test]
fn rollback_discards_compaction_in_removed_turn_without_replaying_tools() {
    let (_, catalog) = fixture_source(vec![
        json!({"type":"event_msg","payload":{"type":"turn_started","turn_id":"a"}}),
        message("user", "keep this requirement"),
        message("assistant", "first answer"),
        json!({"type":"event_msg","payload":{"type":"turn_started","turn_id":"b"}}),
        message("user", "discard this task"),
        json!({"type":"response_item","payload":{"type":"function_call","call_id":"call","name":"write","arguments":{"path":"never-replay.txt"}}}),
        json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"call","output":"done"}}),
        json!({"type":"compacted","payload":{"replacement_history":[{"type":"message","role":"user","content":"removed summary"}]}}),
        json!({"type":"event_msg","payload":{"type":"thread_rolled_back","num_turns":1}}),
        json!({"type":"event_msg","payload":{"type":"turn_started","turn_id":"c"}}),
        message("user", "new question"),
        message("assistant", "recent answer"),
    ]);
    let candidate = &catalog.sessions["fixture"];
    let converted = convert::convert(
        &catalog,
        candidate,
        history::load(&catalog, candidate).unwrap(),
    )
    .unwrap();
    let context = serde_json::to_string(&converted.context).unwrap();
    assert!(converted.complete);
    assert!(context.contains("keep this requirement"));
    assert!(context.contains("recent answer"));
    assert!(!context.contains("removed summary"));
    assert!(!context.contains("discard this task"));
    assert!(!context.contains("never-replay"));
    assert!(converted
        .messages
        .iter()
        .any(|m| m.tool_status.as_deref() == Some("success")));
}

#[test]
fn paginated_history_keeps_unprojected_tail_and_more_than_250_candidates() {
    let (path, _) = fixture_source(vec![
        message("user", "projected question"),
        message("assistant", "projected answer"),
        message("user", "new tail without id"),
        message("assistant", "最新回复"),
    ]);
    let db = rusqlite::Connection::open(path.join("state_5.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE threads(id TEXT, rollout_path TEXT, cwd TEXT, title TEXT, history_mode TEXT);").unwrap();
    for i in 0..301 {
        db.execute(
            "INSERT INTO threads VALUES(?1,?2,?3,?4,'paginated')",
            rusqlite::params![
                if i == 0 {
                    "fixture".into()
                } else {
                    format!("other-{i}")
                },
                path.join("sessions/fixture.jsonl").to_string_lossy(),
                path.to_string_lossy(),
                format!("Conversation {i}")
            ],
        )
        .unwrap();
    }
    drop(db);
    let db = rusqlite::Connection::open(path.join("thread_history_1.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE thread_items(thread_id TEXT,item_id TEXT,rollout_ordinal INTEGER,created_at_ms INTEGER,item_json TEXT,updated_at_ordinal INTEGER); CREATE TABLE thread_history_projection_state(thread_id TEXT,next_rollout_ordinal INTEGER); INSERT INTO thread_history_projection_state VALUES('fixture',3);").unwrap();
    for (ordinal, item) in [
        (
            1,
            json!({"type":"userMessage","id":"u","content":[{"type":"text","text":"projected question"}]}),
        ),
        (
            2,
            json!({"type":"agentMessage","id":"a","text":"projected answer"}),
        ),
    ] {
        db.execute(
            "INSERT INTO thread_items VALUES('fixture',?1,?2,0,?3,?2)",
            rusqlite::params![ordinal.to_string(), ordinal, item.to_string()],
        )
        .unwrap();
    }
    drop(db);
    let catalog = catalog::scan(Some(path.to_string_lossy().into())).unwrap();
    assert_eq!(catalog.sessions.len(), 301);
    let candidate = &catalog.sessions["fixture"];
    let converted = convert::convert(
        &catalog,
        candidate,
        history::load(&catalog, candidate).unwrap(),
    )
    .unwrap();
    assert!(converted.complete);
    assert_eq!(converted.messages.len(), 4);
    assert_eq!(converted.messages.last().unwrap().content, "最新回复");
    assert_eq!(
        serde_json::to_string(&converted.context)
            .unwrap()
            .matches("projected question")
            .count(),
        1
    );
}

#[test]
fn image_and_retained_only_checkpoint_are_preserved_without_source_permissions() {
    let (_, catalog) = fixture_source(vec![
        message("user", "visible old request"),
        json!({"type":"compacted","payload":{"replacement_history":[],"retained_context":{"verified_answers":[{"turn_id":"a","call_id":"answer","order":1,"questions":[{"question":"color?","answer":"green"}]}]}}}),
        json!({"type":"response_item","payload":{"type":"message","role":"developer","content":"Codex permission grant should not apply"}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_image","image_url":"data:image/png;base64,aW1hZ2U="}]}}),
    ]);
    let candidate = &catalog.sessions["fixture"];
    let converted = convert::convert(
        &catalog,
        candidate,
        history::load(&catalog, candidate).unwrap(),
    )
    .unwrap();
    assert!(converted.complete);
    assert!(!converted.blobs.is_empty());
    assert!(converted
        .messages
        .iter()
        .any(|m| m.attachments.as_ref().is_some_and(|a| !a.is_empty())));
    let context = serde_json::to_string(&converted.context).unwrap();
    assert!(context.contains("green"));
    assert!(context.contains("aW1hZ2U="));
    assert!(!context.contains("permission grant"));
}

#[tokio::test]
async fn incomplete_history_requires_confirmation_and_directory_binding_before_execution() {
    let (path, _) = fixture_source(vec![
        message("user", "read old work"),
        json!({"type":"response_item","payload":{"type":"future_unknown_item","value":"preserve this"}}),
    ]);
    let data = tempfile::tempdir().unwrap().keep();
    let state = Arc::new(Mutex::new(AppState::open(&data).unwrap()));
    let scan = handle(
        state.clone(),
        "codex.import.scan",
        json!({"directory":path}),
    )
    .await
    .unwrap();
    let input = json!({"scanId":scan["scanId"],"externalId":"fixture","runId":"test-run","projectPath":null});
    let result = handle(state.clone(), "codex.import.run", input.clone())
        .await
        .unwrap();
    assert_eq!(result["status"], "needsConfirmation");
    assert!(
        sessions::get_session_summary(&state.lock().await.db, "import-codex-fixture")
            .unwrap()
            .is_none()
    );
    let mut confirmed = input;
    confirmed["historyOnly"] = json!(true);
    assert_eq!(
        handle(state.clone(), "codex.import.run", confirmed)
            .await
            .unwrap()["status"],
        "imported"
    );
    let st = state.lock().await;
    assert!(
        sessions::begin_turn(&st.db, "import-codex-fixture", None, None)
            .unwrap_err()
            .to_string()
            .contains("DIRECTORY_REQUIRED")
    );
    sessions::move_session_project(&st.db, "import-codex-fixture", path.to_str().unwrap()).unwrap();
    assert!(sessions::begin_turn(&st.db, "import-codex-fixture", None, None).is_ok());
}

#[test]
fn fork_boundary_limits_only_the_parent_segment_and_keeps_earlier_base() {
    let (path, _) = fixture_source(vec![
        message("user", "grandparent retained"),
        message("assistant", "grandparent answer"),
    ]);
    let parent = [
        json!({"type":"session_meta","payload":{"id":"parent","cwd":path,"history_base":{"thread_id":"fixture","end_ordinal_exclusive":3}}}),
        message("user", "parent retained"),
        message("assistant", "parent excluded"),
    ];
    let child = [
        json!({"type":"session_meta","payload":{"id":"child","cwd":path,"history_base":{"thread_id":"parent","end_ordinal_exclusive":2}}}),
        message("user", "child newest"),
    ];
    for (name, lines) in [("parent", parent.as_slice()), ("child", child.as_slice())] {
        fs::write(
            path.join(format!("sessions/{name}.jsonl")),
            lines.iter().map(|v| format!("{v}\n")).collect::<String>(),
        )
        .unwrap();
    }
    let catalog = catalog::scan(Some(path.to_string_lossy().into())).unwrap();
    let candidate = &catalog.sessions["child"];
    let converted = convert::convert(
        &catalog,
        candidate,
        history::load(&catalog, candidate).unwrap(),
    )
    .unwrap();
    let context = serde_json::to_string(&converted.context).unwrap();
    assert!(converted.complete);
    assert!(context.contains("grandparent retained"));
    assert!(context.contains("parent retained"));
    assert!(context.contains("child newest"));
    assert!(!context.contains("parent excluded"));
}

#[tokio::test]
async fn pagination_release_and_standalone_file_are_explicit() {
    let (path, _) = fixture_source(vec![message("user", "one")]);
    let data = tempfile::tempdir().unwrap().keep();
    let state = Arc::new(Mutex::new(AppState::open(&data).unwrap()));
    let scan = handle(
        state.clone(),
        "codex.import.scan",
        json!({"directory":path.join("sessions/fixture.jsonl")}),
    )
    .await
    .unwrap();
    assert_eq!(
        scan["sourceDirectory"],
        json!(path.join("sessions/fixture.jsonl"))
    );
    let page = handle(
        state.clone(),
        "codex.import.page",
        json!({"scanId":scan["scanId"],"offset":0,"limit":1}),
    )
    .await
    .unwrap();
    assert_eq!(page["total"], 1);
    assert_eq!(page["sessions"].as_array().unwrap().len(), 1);
    handle(
        state.clone(),
        "codex.import.cancel",
        json!({"scanId":scan["scanId"],"release":true}),
    )
    .await
    .unwrap();
    assert!(handle(
        state.clone(),
        "codex.import.run",
        json!({"scanId":scan["scanId"],"externalId":"fixture","runId":"test-run"})
    )
    .await
    .is_err());
}

#[tokio::test]
async fn cancelled_batch_does_not_reenable_itself_and_a_new_batch_can_retry() {
    let (path, _) = fixture_source(vec![message("user", "retry this import")]);
    let data = tempfile::tempdir().unwrap().keep();
    let state = Arc::new(Mutex::new(AppState::open(&data).unwrap()));
    let scan = handle(
        state.clone(),
        "codex.import.scan",
        json!({"directory":path}),
    )
    .await
    .unwrap();
    handle(
        state.clone(),
        "codex.import.cancel",
        json!({"scanId":scan["scanId"],"runId":"cancelled"}),
    )
    .await
    .unwrap();
    let request = json!({"scanId":scan["scanId"],"runId":"cancelled","externalId":"fixture"});
    assert_eq!(
        handle(state.clone(), "codex.import.run", request.clone())
            .await
            .unwrap()["status"],
        "cancelled"
    );
    assert!(
        sessions::get_session_summary(&state.lock().await.db, "import-codex-fixture")
            .unwrap()
            .is_none()
    );
    let mut retry = request;
    retry["runId"] = json!("new-batch");
    assert_eq!(
        handle(state, "codex.import.run", retry).await.unwrap()["status"],
        "imported"
    );
}

#[tokio::test]
async fn project_mapping_keeps_source_identity_roots_and_worktree_directory() {
    let (path, _) = fixture_source(vec![message("user", "project requirement")]);
    let worktree = path.join("worktree");
    let second = path.join("second");
    fs::create_dir(&worktree).unwrap();
    fs::create_dir(&second).unwrap();
    let records = [
        json!({"type":"session_meta","payload":{"id":"worktree","cwd":worktree}}),
        message("user", "worktree task"),
    ];
    fs::write(
        path.join("sessions/worktree.jsonl"),
        records.iter().map(|r| format!("{r}\n")).collect::<String>(),
    )
    .unwrap();
    fs::write(path.join(".codex-global-state.json"), json!({"local-projects":{"source-project":{"name":"Same display name","rootPaths":[path,second]}},"thread-project-assignments":{"fixture":{"projectId":"source-project"},"worktree":{"projectId":"source-project"}}}).to_string()).unwrap();
    let data = tempfile::tempdir().unwrap().keep();
    let state = Arc::new(Mutex::new(AppState::open(&data).unwrap()));
    let scan = handle(
        state.clone(),
        "codex.import.scan",
        json!({"directory":path}),
    )
    .await
    .unwrap();
    for id in ["fixture", "worktree"] {
        assert_eq!(
            handle(
                state.clone(),
                "codex.import.run",
                json!({"scanId":scan["scanId"],"runId":"roots","externalId":id})
            )
            .await
            .unwrap()["status"],
            "imported"
        );
    }
    let st = state.lock().await;
    let groups = st.db.list_project_groups().unwrap();
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].roots.len(), 3);
    assert!(same_path(
        sessions::get_session_summary(&st.db, "import-codex-worktree")
            .unwrap()
            .unwrap()
            .project_path
            .as_deref()
            .unwrap(),
        &worktree.to_string_lossy()
    ));
    assert_eq!(
        projects::mapped_directory(
            Some(worktree.to_str().unwrap()),
            &json!({path.to_string_lossy().to_string():second})
        )
        .unwrap(),
        Some(second.join("worktree").to_string_lossy().into())
    );
}

#[test]
fn incomplete_messages_and_unknown_parts_are_visible_but_not_claimed_as_restored() {
    let (path, catalog) = fixture_source(vec![
        message("user", "complete request"),
        json!({"type":"response_item","payload":{"type":"message","role":"assistant","status":"in_progress","content":"unfinished answer"}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_audio","reference":"preserve-reference"}]}}),
    ]);
    let candidate = &catalog.sessions["fixture"];
    let converted = convert::convert(
        &catalog,
        candidate,
        history::load(&catalog, candidate).unwrap(),
    )
    .unwrap();
    assert!(!converted.complete);
    assert!(converted
        .messages
        .iter()
        .any(|m| m.content.contains("preserve-reference")));
    assert!(converted
        .messages
        .iter()
        .any(|m| m.content == "unfinished answer"));
    assert!(!serde_json::to_string(&converted.context)
        .unwrap()
        .contains("unfinished answer"));
    use std::io::Write;
    fs::OpenOptions::new()
        .append(true)
        .open(path.join("sessions/fixture.jsonl"))
        .unwrap()
        .write_all(b"{malformed-preserve-me")
        .unwrap();
    let converted = convert::convert(
        &catalog,
        candidate,
        history::load(&catalog, candidate).unwrap(),
    )
    .unwrap();
    assert!(converted
        .messages
        .iter()
        .any(|m| m.content.contains("malformed-preserve-me")));
}

#[tokio::test]
async fn scan_import_resume_and_repeat_preserve_native_history() {
    let source = tempfile::tempdir().unwrap().keep();
    let data = tempfile::tempdir().unwrap().keep();
    let project = tempfile::tempdir().unwrap().keep();
    fs::create_dir(source.as_path().join("sessions")).unwrap();
    let lines = [
        json!({"type":"session_meta","payload":{"id":"fixture","cwd":project.as_path(),"timestamp":"2026-10-25T00:00:00Z"}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"old question"}]}}),
        json!({"type":"compacted","payload":{"message":"do not duplicate","replacement_history":[{"type":"message","role":"user","content":[{"type":"input_text","text":"effective summary"}]}]}}),
        json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"latest answer"}]}}),
    ];
    let raw = lines.iter().map(|l| format!("{l}\n")).collect::<String>();
    fs::write(source.as_path().join("sessions/fixture.jsonl"), &raw).unwrap();
    let state = Arc::new(Mutex::new(AppState::open(data.as_path()).unwrap()));
    let scan = handle(
        state.clone(),
        "codex.import.scan",
        json!({"directory":source.as_path()}),
    )
    .await
    .unwrap();
    let page = handle(
        state.clone(),
        "codex.import.page",
        json!({"scanId":scan["scanId"]}),
    )
    .await
    .unwrap();
    assert_eq!(page["sessions"].as_array().unwrap().len(), 1);
    let input = json!({"scanId":scan["scanId"],"externalId":"fixture","runId":"test-run"});
    let imported = handle(state.clone(), "codex.import.run", input.clone())
        .await
        .unwrap();
    assert_eq!(imported["status"], "imported");
    assert_eq!(imported["context"], "restored");
    assert_eq!(
        handle(state.clone(), "codex.import.run", input)
            .await
            .unwrap()["status"],
        "skipped"
    );
    assert_eq!(
        fs::read_to_string(source.as_path().join("sessions/fixture.jsonl")).unwrap(),
        raw
    );
    let imported_files = walkdir::WalkDir::new(data.as_path())
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|e| e == "jsonl"))
        .map(|e| fs::read_to_string(e.path()).unwrap_or_default())
        .collect::<String>();
    assert!(imported_files.contains("effective summary"));
    assert!(imported_files.contains("old question"));
    assert!(!imported_files.contains("do not duplicate"));
}

#[test]
fn completed_failures_and_unfinished_tools_remain_historical() {
    let (_, catalog) = fixture_source(vec![
        message("user", "tool task"),
        json!({"type":"response_item","payload":{"type":"function_call","call_id":"failed","name":"exec","arguments":"{}"}}),
        json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"failed","output":"Process exited with code 2"}}),
        json!({"type":"response_item","payload":{"type":"function_call","call_id":"pending","name":"exec","arguments":"{}"}}),
    ]);
    let candidate = &catalog.sessions["fixture"];
    let converted = convert::convert(
        &catalog,
        candidate,
        history::load(&catalog, candidate).unwrap(),
    )
    .unwrap();
    assert!(converted.complete);
    assert!(converted
        .messages
        .iter()
        .any(|m| m.tool_status.as_deref() == Some("error")));
    assert!(converted
        .messages
        .iter()
        .any(|m| m.tool_status.as_deref() == Some("aborted")));
    assert!(converted.context.iter().all(|m| m["role"] == "user"));
}
