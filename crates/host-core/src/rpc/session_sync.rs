use super::*;

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: &Value,
) -> std::result::Result<Value, JsonRpcError> {
    let id = params
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
    let st = state.lock().await;
    if sessions::session_summary(&st.db, id)
        .map_err(map_error)?
        .is_none()
    {
        return Err(rpc_err(1004, "session not found", "NOT_FOUND"));
    }
    if method == "session.syncRevision" {
        let revision = sessions::session_sync_revision(&st.db, id).map_err(map_error)?;
        return Ok(json!({ "syncRevision": revision }));
    }
    let after_revision = params
        .get("afterRevision")
        .map(Value::as_i64)
        .unwrap_or(Some(0))
        .filter(|n| *n >= 0)
        .ok_or_else(|| rpc_err(1002, "afterRevision must be non-negative", "INVALID_PARAMS"))?;
    let limit = params
        .get("limit")
        .map(Value::as_i64)
        .unwrap_or(Some(50))
        .filter(|n| *n > 0)
        .ok_or_else(|| rpc_err(1002, "limit must be positive", "INVALID_PARAMS"))?;
    let content_limit = match params.get("contentLimit") {
        Some(value) => Some(
            value
                .as_u64()
                .filter(|n| *n > 0)
                .ok_or_else(|| rpc_err(1002, "contentLimit must be positive", "INVALID_PARAMS"))?
                .min(256 * 1024) as usize,
        ),
        None => None,
    };
    let page = sessions::list_session_changes(&st.db, id, after_revision, limit, content_limit)
        .map_err(map_error)?;
    Ok(json!(page))
}

fn map_error(error: anyhow::Error) -> JsonRpcError {
    let message = error.to_string();
    if message.starts_with("NOT_FOUND:") {
        rpc_err(1004, message, "NOT_FOUND")
    } else if message.starts_with("INVALID_PARAMS:") {
        rpc_err(1002, message, "INVALID_PARAMS")
    } else {
        rpc_err(1000, message, "INTERNAL")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn history_position_and_changes_survive_an_actual_host_restart() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = AppState::open(dir.path()).unwrap();
        app.handshook = true;
        let state = Arc::new(Mutex::new(app));
        let (tx, _rx) = mpsc::unbounded_channel();
        let created = handle_request(state.clone(), "session.create", json!({}), tx.clone())
            .await
            .unwrap();
        let id = created["session"]["id"].as_str().unwrap().to_string();
        for index in 0..3 {
            handle_request(
                state.clone(),
                "session.appendMessage",
                json!({
                    "sessionId": id,
                    "message": {"id": format!("m{index}"), "role": "user", "content": "hello",
                        "createdAt": "2026-10-06T00:00:00Z"}
                }),
                tx.clone(),
            )
            .await
            .unwrap();
        }
        let history = handle_request(
            state.clone(),
            "session.get",
            json!({"id": id, "messageLimit": 1}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(history["session"]["syncRevision"], 3);
        drop(state);

        let mut app = AppState::open(dir.path()).unwrap();
        app.handshook = true;
        let state = Arc::new(Mutex::new(app));
        let first = handle_request(
            state.clone(),
            "session.changes",
            json!({"sessionId": id, "afterRevision": 1, "limit": 1}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(first["changes"].as_array().unwrap().len(), 1);
        assert_eq!(first["changes"][0]["message"]["id"], "m1");
        assert_eq!(first["revision"], 2);
        assert_eq!(first["hasMore"], true);
        let next = handle_request(
            state.clone(),
            "session.changes",
            json!({"sessionId": id, "afterRevision": first["revision"]}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(next["revision"], 3);
        assert_eq!(next["hasMore"], false);
        let revision = handle_request(
            state.clone(),
            "session.syncRevision",
            json!({"sessionId": id}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(revision["syncRevision"], 3);
        for invalid in [
            json!({"sessionId": id, "afterRevision": -1}),
            json!({"sessionId": id, "limit": 0}),
        ] {
            let error = handle_request(state.clone(), "session.changes", invalid, tx.clone())
                .await
                .unwrap_err();
            assert_eq!(error.data.unwrap()["errorCode"], "INVALID_PARAMS");
        }
    }
}
