use super::*;
use std::fs;

#[tokio::test]
async fn migrated_project_filter_finds_named_conversation_and_imports_once() {
    let source = tempfile::tempdir().unwrap().keep();
    let data = tempfile::tempdir().unwrap().keep();
    let workspace = source.join("workspace");
    fs::create_dir(&workspace).unwrap();
    fs::create_dir(source.join("sessions")).unwrap();
    let records = [
        json!({"type":"session_meta","payload":{"id":"legacy-thread","cwd":workspace}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":"Keep this task context"}}),
    ];
    let rollout = source.join("sessions/thread.jsonl");
    fs::write(
        &rollout,
        records.iter().map(|r| format!("{r}\n")).collect::<String>(),
    )
    .unwrap();
    let db = rusqlite::Connection::open(source.join("state_5.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE threads(id TEXT, rollout_path TEXT, cwd TEXT, title TEXT, name TEXT, project_id TEXT); CREATE TABLE projects(id TEXT, name TEXT); CREATE TABLE project_roots(project_id TEXT, path TEXT, position INTEGER); INSERT INTO projects VALUES('server-project','Sample project'),('unrelated-project','Sample project');").unwrap();
    db.execute(
        "INSERT INTO project_roots VALUES('server-project',?1,0)",
        [workspace.to_str().unwrap()],
    )
    .unwrap();
    db.execute("INSERT INTO threads VALUES('legacy-thread',?1,?2,'Original task prompt','Named conversation',NULL)", rusqlite::params![rollout.to_str().unwrap(), workspace.to_str().unwrap()]).unwrap();
    drop(db);
    fs::write(
        source.join("session_index.jsonl"),
        format!(
            "{}\n",
            json!({"id":"legacy-thread","thread_name":"Outdated index title"})
        ),
    )
    .unwrap();
    let global = json!({
        "local-projects": {"legacy-project": {"name":"Old project label","rootPaths":[workspace]}},
        "thread-project-assignments": {"legacy-thread": {"projectKind":"local","projectId":"legacy-project"}},
        "app-server-project-id-by-legacy-project-id-by-host": {
            format!("local:{}", source.display()): {"legacy-project":"server-project"},
            "remote:unrelated": {"legacy-project":"unrelated-project"}
        }
    });
    fs::write(source.join(".codex-global-state.json"), global.to_string()).unwrap();
    let state = Arc::new(Mutex::new(AppState::open(&data).unwrap()));
    let scan = handle(
        state.clone(),
        "codex.import.scan",
        json!({"directory":source}),
    )
    .await
    .unwrap();
    assert_eq!(
        scan["projects"].as_array().unwrap().len(),
        2,
        "One migrated project must not appear twice"
    );
    let project = scan["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "server-project")
        .unwrap();
    assert_eq!(project["sessionIds"], json!(["legacy-thread"]));
    assert_eq!(project["name"], "Sample project");
    let page = handle(
        state.clone(),
        "codex.import.page",
        json!({"scanId":scan["scanId"],"projectId":"server-project","query":"Named conversation"}),
    )
    .await
    .unwrap();
    assert_eq!(page["total"], 1);
    assert_eq!(page["sessions"][0]["id"], "legacy-thread");
    let input =
        json!({"scanId":scan["scanId"],"externalId":"legacy-thread","runId":"migration-repro"});
    assert_eq!(
        handle(state.clone(), "codex.import.run", input.clone())
            .await
            .unwrap()["status"],
        "imported"
    );
    assert_eq!(
        handle(state.clone(), "codex.import.run", input)
            .await
            .unwrap()["status"],
        "skipped"
    );
    let st = state.lock().await;
    assert_eq!(
        st.db.list_project_groups().unwrap()[0].name,
        "Sample project"
    );
    assert_eq!(
        sessions::get_session_summary(&st.db, "import-codex-legacy-thread")
            .unwrap()
            .unwrap()
            .title,
        "Named conversation"
    );
}
