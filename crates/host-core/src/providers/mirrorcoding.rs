use super::model::{MirrorCodingGroupRoute, MirrorCodingProvider};
use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorCodingProviderSync {
    pub account_id: Option<i64>,
    pub groups: Vec<MirrorCodingGroupSync>,
}

#[derive(Debug, Deserialize)]
pub struct MirrorCodingGroupSync {
    pub metadata: MirrorCodingProvider,
    pub models: Vec<ModelBinding>,
}

fn account_provider_id(account_id: i64) -> String {
    format!("mirrorcoding-account-{account_id}")
}

fn route_metadata(metadata: &MirrorCodingProvider) -> MirrorCodingGroupRoute {
    MirrorCodingGroupRoute {
        id: metadata.group_id.clone(),
        name: metadata.group_name.clone(),
        description: metadata.description.clone(),
        ratio: metadata.ratio,
        dynamic_billing: metadata.dynamic_billing,
        routes: metadata.routes.clone(),
        image_routes: metadata.image_routes.clone(),
        image_capabilities: metadata.image_capabilities.clone(),
        image_models: metadata.image_models.clone(),
    }
}

fn account_metadata(account_id: i64, groups: &[MirrorCodingGroupSync]) -> MirrorCodingProvider {
    let mut routes = std::collections::BTreeMap::new();
    let mut image_routes = std::collections::BTreeMap::new();
    let mut image_capabilities = std::collections::BTreeMap::new();
    let mut image_models = std::collections::BTreeMap::new();
    let group_routes = groups
        .iter()
        .map(|group| route_metadata(&group.metadata))
        .collect();
    for group in groups {
        for (model_id, endpoint) in &group.metadata.routes {
            routes
                .entry(model_id.clone())
                .or_insert_with(|| endpoint.clone());
        }
        if let Some(values) = &group.metadata.image_routes {
            for (model_id, route) in values {
                image_routes
                    .entry(model_id.clone())
                    .or_insert_with(|| route.clone());
            }
        }
        if let Some(values) = &group.metadata.image_capabilities {
            for (model_id, capability) in values {
                image_capabilities
                    .entry(model_id.clone())
                    .or_insert_with(|| capability.clone());
            }
        }
        if let Some(values) = &group.metadata.image_models {
            for (model_id, capability) in values {
                image_models
                    .entry(model_id.clone())
                    .or_insert_with(|| capability.clone());
            }
        }
    }
    MirrorCodingProvider {
        scope: Some("account".into()),
        account_id,
        group_id: "account".into(),
        group_name: "MirrorCoding".into(),
        description: "All authorized MirrorCoding groups".into(),
        ratio: None,
        dynamic_billing: true,
        routes,
        image_routes: (!image_routes.is_empty()).then_some(image_routes),
        image_capabilities: (!image_capabilities.is_empty()).then_some(image_capabilities),
        image_models: (!image_models.is_empty()).then_some(image_models),
        groups: Some(group_routes),
    }
}

fn merge_account_models(
    groups: &[MirrorCodingGroupSync],
    existing: &[ModelBinding],
) -> Vec<ModelBinding> {
    let mut merged = Vec::new();
    for group in groups {
        for model in &group.models {
            if merged
                .iter()
                .any(|item: &ModelBinding| item.id.eq_ignore_ascii_case(&model.id))
            {
                continue;
            }
            let mut selected = existing
                .iter()
                .find(|item| item.id.eq_ignore_ascii_case(&model.id))
                .cloned()
                .unwrap_or_else(|| model.clone());
            let existing_group_is_available = selected
                .mirror_coding_group_id
                .as_deref()
                .map(|group_id| {
                    groups.iter().any(|candidate| {
                        candidate.metadata.group_id == group_id
                            && candidate.models.iter().any(|candidate_model| {
                                candidate_model.id.eq_ignore_ascii_case(&model.id)
                            })
                    })
                })
                .unwrap_or(false);
            if !existing_group_is_available {
                selected.mirror_coding_group_id = Some(
                    model
                        .mirror_coding_group_id
                        .clone()
                        .unwrap_or_else(|| group.metadata.group_id.clone()),
                );
            }
            merged.push(selected);
        }
    }
    merged
}

pub(crate) fn project_account_model_settings(
    db: &Database,
    account_id: i64,
    account_models: &[ModelBinding],
) -> Result<()> {
    let mut stmt = db
        .conn()
        .prepare_cached("SELECT id, config_json FROM providers WHERE auth_kind = 'mirrorcoding'")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);
    for (id, raw) in rows {
        let Some(mut config) = serde_json::from_str::<serde_json::Value>(&raw).ok() else {
            continue;
        };
        let Some(metadata) = config
            .get("mirrorCoding")
            .and_then(|value| serde_json::from_value::<MirrorCodingProvider>(value.clone()).ok())
        else {
            continue;
        };
        if metadata.scope.as_deref() == Some("account") || metadata.account_id != account_id {
            continue;
        }
        let original = config_model_bindings(&raw, None, &id);
        let projected = original
            .iter()
            .map(|model| {
                let mut next = account_models
                    .iter()
                    .find(|candidate| candidate.id.eq_ignore_ascii_case(&model.id))
                    .cloned()
                    .unwrap_or_else(|| model.clone());
                next.mirror_coding_group_id = Some(metadata.group_id.clone());
                next
            })
            .collect::<Vec<_>>();
        config["models"] = serde_json::to_value(normalize_model_bindings(&projected))?;
        db.conn().execute(
            "UPDATE providers SET config_json = ?1, updated_at = ?2 WHERE id = ?3",
            params![config.to_string(), now_ms(), id],
        )?;
    }
    Ok(())
}

/// Refresh the Electron-owned MirrorCoding projection in the existing
/// providers table. Group rows remain addressable for historical sessions;
/// the stable account row is the model-first entry point for new selections.
pub fn sync_mirrorcoding(db: &Database, input: MirrorCodingProviderSync) -> Result<()> {
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
    let Some(account_id) = input.account_id else {
        tx.commit()?;
        return Ok(());
    };
    let now = now_ms();
    let mut seen = std::collections::BTreeSet::new();
    let account_id_key = account_provider_id(account_id);
    let previous_models = existing
        .iter()
        .find(|(id, _)| id == &account_id_key)
        .map(|(_, raw)| config_model_bindings(raw, None, &account_id_key))
        .unwrap_or_default();
    let models = merge_account_models(&input.groups, &previous_models);
    for group in &input.groups {
        let metadata = &group.metadata;
        if metadata.account_id != account_id
            || metadata.group_id.trim().is_empty()
            || !seen.insert(metadata.group_id.clone())
        {
            bail!("invalid MirrorCoding group identity");
        }
        let id = existing
            .iter()
            .find_map(|(id, raw)| {
                let value: serde_json::Value = serde_json::from_str(raw).ok()?;
                let stored: MirrorCodingProvider =
                    serde_json::from_value(value.get("mirrorCoding")?.clone()).ok()?;
                (stored.account_id == metadata.account_id && stored.group_id == metadata.group_id)
                    .then(|| id.clone())
            })
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let projected_models = group
            .models
            .iter()
            .map(|model| {
                let mut selected = models
                    .iter()
                    .find(|item| item.id.eq_ignore_ascii_case(&model.id))
                    .cloned()
                    .unwrap_or_else(|| model.clone());
                selected.mirror_coding_group_id = Some(metadata.group_id.clone());
                selected
            })
            .collect::<Vec<_>>();
        let config = serde_json::json!({ "mirrorCoding": metadata, "models": projected_models });
        tx.execute(
            "INSERT INTO providers (id, name, vendor_key, type, protocol, enabled, base_url, auth_kind, config_json, created_at, updated_at)
             VALUES (?1, ?2, 'mirrorcoding', 'custom', 'mirrorcoding', ?3, 'https://console.mirrorcoding.xyz', 'mirrorcoding', ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled,
             config_json = excluded.config_json, updated_at = excluded.updated_at",
            params![
                id,
                format!("MirrorCoding · {}", metadata.group_name),
                !projected_models.is_empty(),
                config.to_string(),
                now
            ],
        )?;
    }

    let account_metadata = account_metadata(account_id, &input.groups);
    let account_enabled = !models.is_empty();
    let account_config = serde_json::json!({ "mirrorCoding": account_metadata, "models": models });
    tx.execute(
        "INSERT INTO providers (id, name, vendor_key, type, protocol, enabled, base_url, auth_kind, config_json, created_at, updated_at)
         VALUES (?1, 'MirrorCoding', 'mirrorcoding', 'custom', 'mirrorcoding', ?2, 'https://console.mirrorcoding.xyz', 'mirrorcoding', ?3, ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled,
         config_json = excluded.config_json, updated_at = excluded.updated_at",
        params![account_id_key, account_enabled, account_config.to_string(), now],
    )?;
    tx.commit()?;
    Ok(())
}
