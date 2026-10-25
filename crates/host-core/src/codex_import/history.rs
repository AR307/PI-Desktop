use super::catalog::{check, has_table, readonly, text, Candidate, Catalog};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::{collections::HashSet, path::Path};

pub struct History {
    pub records: Vec<Value>,
    pub projected: Vec<Value>,
    pub warnings: Vec<String>,
    pub complete: bool,
}
fn read_file(path: &Path, limit: Option<u64>, catalog: &Catalog) -> Result<Vec<Value>> {
    let mut reader = super::source::reader(path)?;
    let mut records = vec![];
    let mut offset = 0u64;
    let mut bytes = Vec::new();
    let mut next_ordinal = 0;
    loop {
        check(&catalog.cancelled)?;
        bytes.clear();
        let n = reader.read_until(b'\n', &mut bytes)?;
        if n == 0 {
            break;
        }
        offset += n as u64;
        if limit.is_some_and(|end| offset > end) {
            break;
        }
        match serde_json::from_slice::<Value>(&bytes) {
            Ok(mut value) if value.is_object() => {
                let ordinal = value["ordinal"].as_u64().unwrap_or(next_ordinal);
                value["importOrdinal"] = json!(ordinal);
                value["importOffset"] = json!(offset - n as u64);
                records.push(value);
                next_ordinal = ordinal.saturating_add(1);
            }
            _ => {
                records.push(json!({"type":"import_incomplete","payload":"Invalid or unfinished JSONL record","raw":String::from_utf8_lossy(&bytes),"importOrdinal":next_ordinal}));
                next_ordinal += 1;
            }
        }
    }
    Ok(records)
}
fn chain(
    catalog: &Catalog,
    item: &Candidate,
    byte_limit: Option<u64>,
    ordinal_limit: Option<u64>,
    visited: &mut HashSet<String>,
) -> Result<History> {
    let path = item
        .files
        .iter()
        .find_map(|p| super::source::existing_path(p));
    let identity = path
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| item.id.clone());
    let source_id = path
        .as_ref()
        .and_then(|p| super::source::segment_id(p))
        .unwrap_or_else(|| item.id.clone());
    if !visited.insert(identity.clone()) {
        return Err(anyhow!("Codex history_base contains a cycle"));
    }
    let mut records = match path {
        Some(path) => read_file(&path, byte_limit, catalog)?,
        None => vec![],
    };
    if let Some(limit) = ordinal_limit {
        records.retain(|r| {
            r["importOrdinal"]
                .as_u64()
                .is_some_and(|ordinal| ordinal < limit)
        });
    }
    for record in &mut records {
        record["importSource"] = json!(source_id);
    }
    let mut result = History {
        records: vec![],
        projected: vec![],
        warnings: vec![],
        complete: true,
    };
    if let Some(base) = records
        .first()
        .and_then(|r| r["payload"].get("history_base"))
    {
        if let Some(base_id) = text(base, "thread_id") {
            if let Some(parent) = catalog
                .segments
                .get(&base_id)
                .or_else(|| catalog.sessions.get(&base_id))
            {
                result = chain(
                    catalog,
                    parent,
                    base["end_byte_offset"].as_u64(),
                    base["end_ordinal_exclusive"].as_u64(),
                    visited,
                )?;
            } else {
                result.complete = false;
                result
                    .warnings
                    .push("Referenced base history is unavailable".into());
            }
        }
    }
    if item.paginated {
        if let Some(path) = &catalog.history_db {
            let db = readonly(path)?;
            db.execute_batch("BEGIN")?;
            if !has_table(&db, "thread_items")? {
                return Err(anyhow!("Unsupported Codex history database"));
            }
            let mut stmt = db.prepare("SELECT item_json, rollout_ordinal, created_at_ms, updated_at_ordinal FROM thread_items WHERE thread_id=?1 ORDER BY rollout_ordinal, item_id")?;
            let mut rows = stmt.query([&item.id])?;
            while let Some(row) = rows.next()? {
                check(&catalog.cancelled)?;
                let ordinal = row.get::<_, i64>(1)?.max(0) as u64;
                let boundary = ordinal_limit.or_else(|| {
                    byte_limit.and_then(|_| {
                        records
                            .last()
                            .and_then(|r| r["importOrdinal"].as_u64())
                            .map(|n| n + 1)
                    })
                });
                if boundary.is_some_and(|end| ordinal >= end) {
                    continue;
                }
                if boundary.is_some_and(|end| row.get::<_, i64>(3).is_ok_and(|n| n >= end as i64)) {
                    result.complete = false;
                    result.warnings.push(
                        "An inherited projected item was updated after the fork boundary".into(),
                    );
                    continue;
                }
                let raw: String = row.get(0)?;
                let mut value: Value = match serde_json::from_str::<Value>(&raw) {
                    Ok(value) if value.is_object() => value,
                    _ => {
                        result.complete = false;
                        result.warnings.push(
                            "A projected item is malformed; its raw value is preserved for review"
                                .into(),
                        );
                        json!({"type":"unknown_projected_item","raw":raw})
                    }
                };
                value["importOrdinal"] = json!(row.get::<_, i64>(1)?);
                value["importSource"] = json!(source_id);
                value["importTimestamp"] = json!(crate::db::ms_to_ts(row.get(2)?));
                result.projected.push(value);
            }
            if has_table(&db, "thread_history_projection_state")? {
                use rusqlite::OptionalExtension;
                let watermark: Option<i64> = db.query_row("SELECT next_rollout_ordinal FROM thread_history_projection_state WHERE thread_id=?1", [&item.id], |r| r.get(0)).optional()?;
                if let Some(watermark) = watermark {
                    for record in &mut records {
                        record["importVisible"] =
                            json!(record["importOrdinal"].as_i64().unwrap_or(0) >= watermark);
                    }
                } else {
                    result.complete = false;
                    result.warnings.push(
                        "Projection watermark unavailable; overlap cannot be reconciled reliably"
                            .into(),
                    );
                }
            } else {
                result.complete = false;
                result.warnings.push(
                    "Projection watermark table unavailable; overlap cannot be reconciled reliably"
                        .into(),
                );
            }
        } else {
            result
                .warnings
                .push("Paginated history database is missing".into());
            result.complete = false;
        }
    }
    if records.is_empty() {
        result.complete = false;
        result.warnings.push(
            "Model context rollout is unavailable; only projected history can be imported".into(),
        );
    }
    result.records.extend(records);
    visited.remove(&identity);
    Ok(result)
}
pub fn load(catalog: &Catalog, item: &Candidate) -> Result<History> {
    chain(catalog, item, None, None, &mut HashSet::new())
}
