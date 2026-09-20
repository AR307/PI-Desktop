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
        let id = existing
            .iter()
            .find_map(|(id, raw)| {
                let value: serde_json::Value = serde_json::from_str(raw).ok()?;
                let stored: MirrorCodingProvider =
                    serde_json::from_value(value["mirrorCoding"].clone()).ok()?;
                (stored.account_id == metadata.account_id && stored.group_id == metadata.group_id)
                    .then(|| id.clone())
            })
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let config = serde_json::json!({ "mirrorCoding": metadata, "models": group.models });
        tx.execute(
            "INSERT INTO providers (id, name, vendor_key, type, protocol, enabled, base_url, auth_kind, config_json, created_at, updated_at)
             VALUES (?1, ?2, 'mirrorcoding', 'custom', 'mirrorcoding', ?3, 'https://console.mirrorcoding.xyz', 'mirrorcoding', ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled,
             config_json = excluded.config_json, updated_at = excluded.updated_at",
            params![id, format!("MirrorCoding · {}", metadata.group_name), !group.models.is_empty(), config.to_string(), now],
        )?;
    }
    tx.commit()?;
    Ok(())
}
