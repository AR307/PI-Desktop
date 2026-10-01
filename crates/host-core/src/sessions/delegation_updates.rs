use super::*;

/// Task returns before its worker. Refresh that same row when the worker settles,
/// without appending another call, counting usage twice, or reviving a finished run.
pub(super) fn refresh_task(
    db: &Database,
    session_id: &str,
    message: &UiMessage,
    record: &MessageRecord,
    text: Option<&str>,
) -> Result<()> {
    if message.role != "tool" || message.tool_name.as_deref() != Some("Task") {
        return Ok(());
    }
    let Some(next) = message.tool_result.as_ref().and_then(|r| r.get("details")) else {
        return Ok(());
    };
    let Some(id) = next.get("delegationId").and_then(Value::as_str) else {
        return Ok(());
    };
    let layout = session_layout(db, session_id)?;
    let Some(previous) = transcripts::read_tool_call(
        db.data_dir(),
        session_id,
        &layout,
        message.tool_call_id.as_deref().unwrap_or(&message.id),
    )?
    else {
        return Ok(());
    };
    if previous.id != record.id {
        return Ok(());
    }
    let previous = record_to_ui(previous);
    let details = previous.tool_result.as_ref().and_then(|r| r.get("details"));
    if previous.tool_name.as_deref() != Some("Task")
        || details
            .and_then(|d| d.get("delegationId"))
            .and_then(Value::as_str)
            != Some(id)
        || details
            .and_then(|d| d.get("status"))
            .and_then(Value::as_str)
            != Some("running")
    {
        return Ok(());
    }
    invalidate_transcript_layout(session_id);
    if !transcripts::update_message(db.data_dir(), session_id, record)? {
        return Err(anyhow!("delegation Task is missing from its transcript"));
    }
    db.conn().execute(
        "UPDATE messages SET text = ?3, is_error = ?4 WHERE session_id = ?1 AND id = ?2",
        params![session_id, record.id, text, record.is_error],
    )?;
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
    }
}
