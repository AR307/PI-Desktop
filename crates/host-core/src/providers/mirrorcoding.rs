use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorCodingProvider {
    pub account_id: i64,
    pub group_id: String,
    pub group_name: String,
    pub description: String,
    pub ratio: Option<f64>,
    pub dynamic_billing: bool,
    pub routes: BTreeMap<String, String>,
    #[serde(default)]
    pub image_models: BTreeMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorCodingSync {
    pub account_id: Option<i64>,
    pub groups: Vec<MirrorCodingGroupSync>,
}

#[derive(Deserialize)]
pub struct MirrorCodingGroupSync {
    pub metadata: MirrorCodingProvider,
    pub models: Vec<ModelBinding>,
}

fn stored_model_bindings(raw: &str) -> Vec<ModelBinding> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    value
        .get("models")
        .and_then(|models| models.as_array())
        .map(|models| {
            models
                .iter()
                .filter_map(|model| serde_json::from_value(model.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Keep the knobs a person set on a model the account still offers.
///
/// Context window follows the catalog unless its source is `user`. Output
/// limit, thinking levels, and the subagent switch always stay with the stored
/// row. Image-only models are never offered to subagents.
fn merge_group_models(
    stored: &[ModelBinding],
    incoming: Vec<ModelBinding>,
    metadata: &MirrorCodingProvider,
) -> Vec<ModelBinding> {
    incoming
        .into_iter()
        .map(|mut model| {
            let image_only = metadata.image_models.contains_key(&model.id)
                && !metadata.routes.contains_key(&model.id);
            if let Some(previous) = stored.iter().find(|item| item.id == model.id) {
                if previous.context_window_source.as_deref() == Some("user")
                    && previous.context_window > 0
                {
                    model.context_window = previous.context_window;
                    model.context_window_source = Some("user".to_string());
                }
                if previous.max_tokens > 0 {
                    model.max_tokens = previous.max_tokens;
                }
                model.thinking_levels = previous.thinking_levels.clone();
                model.default_thinking_level = previous.default_thinking_level.clone();
                model.available_for_subagents = Some(if image_only {
                    false
                } else {
                    previous.available_for_subagents.unwrap_or(true)
                });
            } else {
                model.available_for_subagents = Some(!image_only);
            }
            model
        })
        .collect()
}

/// Refresh the main-owned account projection without rewriting session choices.
pub fn sync_mirrorcoding(db: &Database, input: MirrorCodingSync) -> Result<()> {
    let existing: Vec<(String, String)> = {
        let mut stmt = db.conn().prepare_cached(
            "SELECT id, config_json FROM providers WHERE auth_kind = 'mirrorcoding'",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let tx = db.conn().unchecked_transaction()?;
    tx.execute(
        "UPDATE providers SET enabled = 0 WHERE auth_kind = 'mirrorcoding'",
        [],
    )?;
    let now = now_ms();
    let mut seen = std::collections::BTreeSet::new();
    for group in input.groups {
        let metadata = &group.metadata;
        if input.account_id != Some(metadata.account_id)
            || metadata.group_id.is_empty()
            || !seen.insert(metadata.group_id.clone())
        {
            bail!("invalid MirrorCoding group identity");
        }
        let stored = existing.iter().find_map(|(id, raw)| {
            let value: serde_json::Value = serde_json::from_str(raw).ok()?;
            let stored: MirrorCodingProvider =
                serde_json::from_value(value["mirrorCoding"].clone()).ok()?;
            (stored.account_id == metadata.account_id && stored.group_id == metadata.group_id)
                .then(|| (id.clone(), raw.clone()))
        });
        let id = stored
            .as_ref()
            .map(|(id, _)| id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let previous = stored
            .as_ref()
            .map(|(_, raw)| stored_model_bindings(raw))
            .unwrap_or_default();
        let models = merge_group_models(&previous, group.models, metadata);
        let config = serde_json::json!({ "mirrorCoding": metadata, "models": models });
        tx.execute(
            "INSERT INTO providers (id, name, vendor_key, type, protocol, enabled, base_url, auth_kind, config_json, created_at, updated_at)
             VALUES (?1, ?2, 'mirrorcoding', 'custom', 'mirrorcoding', ?3, 'https://console.mirrorcoding.xyz', 'mirrorcoding', ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled,
             config_json = excluded.config_json, updated_at = excluded.updated_at",
            params![id, format!("MirrorCoding · {}", metadata.group_name), !models.is_empty(), config.to_string(), now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::SecretStore;

    fn open() -> (tempfile::TempDir, Database, SecretStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
        let secrets = SecretStore::open(dir.path()).unwrap();
        (dir, db, secrets)
    }

    fn model(id: &str, context_window: u32, max_tokens: u32) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "contextWindow": context_window,
            "contextWindowSource": "catalog",
            "maxTokens": max_tokens,
            "thinkingLevels": ["off", "high"],
            "defaultThinkingLevel": "off"
        })
    }

    #[test]
    fn user_context_window_survives_catalog_refresh() {
        let (_dir, db, secrets) = open();
        sync_mirrorcoding(
            &db,
            serde_json::from_value(serde_json::json!({
                "accountId": 7,
                "groups": [{
                    "metadata": {
                        "accountId": 7,
                        "groupId": "fast",
                        "groupName": "Fast",
                        "description": "",
                        "dynamicBilling": false,
                        "routes": { "chat": "openai" },
                        "imageModels": {
                            "painter": { "generation_path": "/v1/images/generations", "max_count": 1, "supports_chat": false }
                        }
                    },
                    "models": [model("chat", 8_000, 1_000), model("painter", 4_000, 1_000), model("retired", 1_000, 100)]
                }]
            }))
            .unwrap(),
        )
        .unwrap();

        let provider = list_providers(&db, &secrets, true)
            .unwrap()
            .into_iter()
            .find(|item| item.auth_kind == "mirrorcoding")
            .unwrap();
        assert_eq!(provider.models[0].available_for_subagents, Some(true));
        assert_eq!(provider.models[1].available_for_subagents, Some(false));

        let mut edited = provider.models.clone();
        edited[0].context_window = 256_000;
        edited[0].context_window_source = Some("user".into());
        edited[0].max_tokens = 4_096;
        edited[0].thinking_levels = vec!["high".into()];
        edited[0].default_thinking_level = Some("high".into());
        edited[0].available_for_subagents = Some(false);
        update_provider(
            &db,
            &secrets,
            ProviderUpdateInput {
                id: provider.id.clone(),
                name: Some("should-not-stick".into()),
                vendor_key: Some("custom".into()),
                provider_type: None,
                protocol: None,
                base_url: Some("https://evil.example".into()),
                auth_kind: None,
                models: Some(edited),
                default_model_id: None,
                secret_value: None,
                api_style: None,
                oauth_account_label: None,
                headers: None,
                supports_reasoning: None,
                supported_thinking_levels: None,
                context_window: None,
                max_output_tokens: None,
                temperature: None,
                enabled: None,
            },
        )
        .unwrap();

        sync_mirrorcoding(
            &db,
            serde_json::from_value(serde_json::json!({
                "accountId": 7,
                "groups": [{
                    "metadata": {
                        "accountId": 7,
                        "groupId": "fast",
                        "groupName": "Fast",
                        "description": "",
                        "dynamicBilling": false,
                        "routes": { "chat": "openai", "fresh": "openai" },
                        "imageModels": {
                            "painter": { "generation_path": "/v1/images/generations", "max_count": 1, "supports_chat": false }
                        }
                    },
                    "models": [model("chat", 32_000, 2_000), model("painter", 4_000, 1_000), model("fresh", 16_000, 2_000)]
                }]
            }))
            .unwrap(),
        )
        .unwrap();

        let refreshed = get_provider(&db, &secrets, &provider.id).unwrap().unwrap();
        assert_eq!(refreshed.base_url.as_deref(), Some("https://console.mirrorcoding.xyz"));
        assert_eq!(refreshed.vendor_key, "mirrorcoding");
        let chat = refreshed.models.iter().find(|item| item.id == "chat").unwrap();
        assert_eq!(chat.context_window, 256_000);
        assert_eq!(chat.context_window_source.as_deref(), Some("user"));
        assert_eq!(chat.max_tokens, 4_096);
        assert_eq!(chat.thinking_levels, vec!["high".to_string()]);
        assert_eq!(chat.available_for_subagents, Some(false));
        assert!(refreshed.models.iter().all(|item| item.id != "retired"));
        let fresh = refreshed.models.iter().find(|item| item.id == "fresh").unwrap();
        assert_eq!(fresh.context_window, 16_000);
        assert_eq!(fresh.available_for_subagents, Some(true));
        assert_eq!(
            refreshed
                .models
                .iter()
                .find(|item| item.id == "painter")
                .unwrap()
                .available_for_subagents,
            Some(false)
        );
    }
}
