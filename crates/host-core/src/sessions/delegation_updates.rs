use super::*;

/// Task is already a completed tool call while its delegated work is running.
/// Only its matching terminal result may replace that provisional result; replay
/// must neither reopen a settled delegate nor overwrite another call's metadata.
pub(super) fn refresh_task(
    db: &Database,
    session_id: &str,
    incoming: &MessageRecord,
) -> Result<()> {
    if incoming.role != "tool" || incoming.tool_name.as_deref() != Some("Task") {
        return Ok(());
    }
    let Some(next) = incoming
        .blocks
        .as_array()
        .and_then(|blocks| blocks.iter().find(|block| block["type"] == "tool_call"))
    else {
        return Ok(());
    };
    let details = &next["result"]["details"];
    if !matches!(
        details["status"].as_str(),
        Some("completed" | "stopped" | "aborted" | "failed" | "timed_out")
    ) {
        return Ok(());
    }
    let Some(id) = details["delegationId"].as_str().filter(|id| !id.is_empty()) else {
        return Ok(());
    };
    let Some(mut existing) = indexed_message_record(db, session_id, &incoming.id)? else {
        return Ok(());
    };
    if existing.role != "tool" || existing.tool_name.as_deref() != Some("Task") {
        return Ok(());
    }
    let Some(block) = existing
        .blocks
        .as_array_mut()
        .and_then(|blocks| blocks.iter_mut().find(|block| block["type"] == "tool_call"))
    else {
        return Ok(());
    };
    if block["callId"] != next["callId"]
        || block["result"]["details"]["delegationId"].as_str() != Some(id)
        || block["result"]["details"]["status"] != "running"
    {
        return Ok(());
    }
    block["result"] = next["result"].clone();
    block["text"] = next["text"].clone();
    invalidate_transcript_layout(session_id);
    if !transcripts::update_message(db.data_dir(), session_id, &existing)? {
        return Err(anyhow!(
            "delegation snapshot is missing from its transcript"
        ));
    }
    let tx = db.conn().unchecked_transaction()?;
    sync::record_upsert(&tx, session_id, &existing.id)?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completed_task_retains_binding_and_reasoning_after_restart_without_duplicate() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("task.sqlite");
        let db = Database::open(&path).unwrap();
        let session = create_session(&db, None, None, None, None, None).unwrap();
        let mut task: UiMessage = serde_json::from_value(json!({
            "id": "task-1", "role": "tool", "content": "started",
            "createdAt": "2026-10-01T00:00:00Z", "toolName": "Task",
            "toolCallId": "task-1", "toolStatus": "success", "status": "complete",
            "toolResult": {"details": {"delegationId": "worker-1", "status": "running"}}
        }))
        .unwrap();
        append_message(&db, &session.id, &task, None).unwrap();
        let initial = task.clone();
        task.tool_result = Some(json!({"details": {
            "delegationId": "worker-1", "status": "completed",
            "modelId": "child", "modelKey": "provider/child",
            "groupId": "Chinese group", "thinkingLevel": "max"
        }}));
        task.content = "completed".into();
        append_message(&db, &session.id, &task, None).unwrap();
        append_message(&db, &session.id, &initial, None).unwrap();
        drop(db);
        let db = Database::open(&path).unwrap();
        let detail = get_session(&db, &session.id).unwrap().unwrap();
        assert_eq!(detail.messages.len(), 1);
        assert_eq!(detail.messages[0].tool_result, task.tool_result);
        assert_eq!(detail.messages[0].content, "completed");
        assert_eq!(session_sync_revision(&db, &session.id).unwrap(), 2);
    }
}
