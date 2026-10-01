use crate::{db::Database, providers};
use anyhow::{bail, Result};
use rusqlite::OptionalExtension;

pub(super) fn resolve(
    db: &Database,
    provider_id: Option<&str>,
    model_id: Option<&str>,
    requested: Option<bool>,
    saved: bool,
) -> Result<bool> {
    let available = match (provider_id, model_id) {
        (Some(provider), Some(model)) => available(db, provider, model)?,
        _ => false,
    };
    if requested == Some(true) && !available {
        bail!("PI_FAST_UNAVAILABLE");
    }
    Ok(requested.unwrap_or(saved) && available)
}

fn available(db: &Database, provider_id: &str, model_id: &str) -> Result<bool> {
    let row = db
        .conn()
        .prepare_cached("SELECT enabled, config_json FROM providers WHERE id = ?1")?
        .query_row([provider_id], |row| {
            Ok((row.get::<_, bool>(0)?, row.get::<_, String>(1)?))
        })
        .optional()?;
    let Some((true, config)) = row else {
        return Ok(false);
    };
    let value: serde_json::Value = serde_json::from_str(&config)?;
    let Some(meta) = value.get("mirrorCoding") else {
        return Ok(false);
    };
    let models = providers::config_model_bindings(&config, None, provider_id);
    let group = if meta["scope"].as_str() == Some("account") {
        let group_id = models
            .iter()
            .find(|model| model.id == model_id)
            .and_then(|model| model.mirror_coding_group_id.as_deref());
        let Some(group) = meta["groups"]
            .as_array()
            .and_then(|groups| groups.iter().find(|group| group["id"].as_str() == group_id))
        else {
            return Ok(false);
        };
        group
    } else {
        meta
    };
    let Some(endpoint) = group["routes"][model_id].as_str() else {
        return Ok(false);
    };
    if endpoint != "openai" && endpoint != "openai-response" {
        return Ok(false);
    }
    let capability = &group["modelCapabilities"][model_id];
    let text = capability
        .get("modes")
        .and_then(|value| value.as_array())
        .is_some_and(|values| values.iter().any(|value| value.as_str() == Some("text")));
    let fast = &capability["fast"];
    Ok(text
        && fast["enabled"].as_bool() == Some(true)
        && fast["supportedEndpointTypes"]
            .as_array()
            .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(endpoint))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::{
        begin_turn, configure_session_with_thinking, create_session, delete_session,
        get_session_summary,
    };
    use serde_json::json;

    fn catalog(db: &Database, enabled: bool) {
        let groups = ["fast-group", "other-fast-group", "slow-group"].into_iter().map(|id| json!({
            "metadata": { "scope":"group", "accountId":901, "groupId":id,
                "groupName":id, "description":"Controlled fixture", "ratio":1.0,
                "dynamicBilling":false, "routes":{"gpt-test":"openai", "gpt-next":"openai"},
                "modelCapabilities":{"gpt-test":{"modes":["text"], "supportedEndpointTypes":["openai"],
                    "fast":{"enabled":enabled && id != "slow-group", "supportedEndpointTypes":["openai"]}},
                    "gpt-next":{"modes":["text"], "supportedEndpointTypes":["openai"],
                    "fast":{"enabled":enabled && id != "slow-group", "supportedEndpointTypes":["openai"]}}},
                "supportedEndpoints":{"openai":{"path":"/v1/chat/completions","method":"POST"}}
            },
            "models":[{"id":"gpt-test", "contextWindow":128000, "maxTokens":8192,
                "thinkingLevels":["off","high"], "defaultThinkingLevel":"off", "mirrorCodingGroupId":id},
                {"id":"gpt-next", "contextWindow":128000, "maxTokens":8192,
                "thinkingLevels":["off","high"], "defaultThinkingLevel":"off", "mirrorCodingGroupId":id}]
        })).collect::<Vec<_>>();
        providers::sync_mirrorcoding(
            db,
            serde_json::from_value(json!({"accountId":901,"groups":groups})).unwrap(),
        )
        .unwrap();
    }

    fn group_provider(db: &Database, group: &str) -> String {
        db.conn().query_row("SELECT id FROM providers WHERE json_extract(config_json, '$.mirrorCoding.scope') = 'group' AND json_extract(config_json, '$.mirrorCoding.groupId') = ?1", [group], |row| row.get(0)).unwrap()
    }

    #[test]
    fn session_fast_survives_restart_and_running_edits_without_changing_active_turn() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi.sqlite");
        let db = Database::open(&path).unwrap();
        catalog(&db, true);
        let provider = group_provider(&db, "fast-group");
        let session = create_session(
            &db,
            None,
            Some("agent".into()),
            Some(provider.clone()),
            Some("gpt-test".into()),
            None,
        )
        .unwrap();
        assert!(!session.fast);
        let turn = begin_turn(&db, &session.id, Some(&provider), Some("gpt-test")).unwrap();
        let next = configure_session_with_thinking(
            &db,
            &session.id,
            "agent",
            None,
            None,
            Some("high"),
            None,
            Some(true),
            None,
        )
        .unwrap()
        .unwrap();
        assert!(next.fast);
        assert_eq!(next.thinking_level, "high");
        let actual: String = db
            .conn()
            .query_row(
                "SELECT provider_id FROM turns WHERE id = ?1",
                [&turn],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(actual, provider);
        drop(db);
        let reopened = Database::open(&path).unwrap();
        assert!(
            get_session_summary(&reopened, &session.id)
                .unwrap()
                .unwrap()
                .fast
        );
        delete_session(&reopened, &session.id).unwrap();
        let count: i64 = reopened
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM kv WHERE key = ?1",
                [format!("session-fast:{}", session.id)],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn switching_model_or_group_requires_explicit_fast_opt_in() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
        catalog(&db, true);
        let first = group_provider(&db, "fast-group");
        let second = group_provider(&db, "other-fast-group");
        let session = create_session(
            &db,
            None,
            Some("agent".into()),
            Some(first.clone()),
            Some("gpt-test".into()),
            None,
        )
        .unwrap();
        let configure = |provider: Option<&str>, model: Option<&str>, fast: Option<bool>| {
            configure_session_with_thinking(
                &db,
                &session.id,
                "agent",
                provider,
                model,
                Some("high"),
                None,
                fast,
                None,
            )
            .unwrap()
            .unwrap()
        };

        assert!(configure(None, None, Some(true)).fast);
        assert!(
            !configure(None, Some("gpt-next"), None).fast,
            "a different Fast-capable model must start with Fast off"
        );
        assert!(configure(None, None, Some(true)).fast);
        assert!(
            configure(Some(&first), Some("gpt-next"), None).fast,
            "reasoning changes and reselecting the same model preserve Fast"
        );
        assert!(
            !configure(Some(&second), None, None).fast,
            "a different group must not inherit the previous selection's Fast"
        );
        assert!(
            configure(Some(&first), Some("gpt-test"), Some(true)).fast,
            "mobile can explicitly opt in after selecting a model in one save"
        );
        assert!(!configure(Some(&second), Some("gpt-next"), None).fast);
    }

    #[test]
    fn session_fast_uses_selected_group_and_rejects_atomic_invalid_updates() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
        catalog(&db, true);
        let fast = group_provider(&db, "fast-group");
        let slow = group_provider(&db, "slow-group");
        let session = create_session(
            &db,
            None,
            Some("agent".into()),
            Some(fast.clone()),
            Some("gpt-test".into()),
            None,
        )
        .unwrap();
        configure_session_with_thinking(
            &db,
            &session.id,
            "agent",
            None,
            None,
            None,
            None,
            Some(true),
            None,
        )
        .unwrap();
        let error = configure_session_with_thinking(
            &db,
            &session.id,
            "agent",
            Some(&slow),
            None,
            Some("high"),
            None,
            Some(true),
            None,
        )
        .unwrap_err();
        assert!(error.to_string().contains("PI_FAST_UNAVAILABLE"));
        let saved = get_session_summary(&db, &session.id).unwrap().unwrap();
        assert_eq!(saved.provider_id.as_deref(), Some(fast.as_str()));
        assert!(saved.fast);
        let changed = configure_session_with_thinking(
            &db,
            &session.id,
            "agent",
            Some(&slow),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap();
        assert!(!changed.fast);
        catalog(&db, false);
        assert!(resolve(&db, Some(&fast), Some("gpt-test"), Some(true), false).is_err());
        providers::sync_mirrorcoding(
            &db,
            serde_json::from_value(json!({"accountId":901,"groups":[]})).unwrap(),
        )
        .unwrap();
        assert!(!resolve(&db, Some(&fast), Some("gpt-test"), None, true).unwrap());
    }
}
