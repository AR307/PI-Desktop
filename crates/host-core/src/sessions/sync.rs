use super::*;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SessionChange {
    Upsert {
        revision: i64,
        #[serde(rename = "messageId")]
        message_id: String,
        sequence: i64,
        message: Box<UiMessage>,
    },
    Delete {
        revision: i64,
        #[serde(rename = "messageId")]
        message_id: String,
    },
}

impl SessionChange {
    fn revision(&self) -> i64 {
        match self {
            Self::Upsert { revision, .. } | Self::Delete { revision, .. } => *revision,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionChangesPage {
    pub session_id: String,
    pub after_revision: i64,
    /// The last position actually included, not the current head when paging.
    pub revision: i64,
    pub has_more: bool,
    pub changes: Vec<SessionChange>,
}

pub fn session_sync_revision(db: &Database, session_id: &str) -> Result<i64> {
    Ok(db
        .conn()
        .prepare_cached("SELECT revision FROM session_sync_state WHERE session_id = ?1")?
        .query_row(params![session_id], |row| row.get(0))
        .optional()?
        .unwrap_or(0))
}

/// Called inside the same transaction that changes the transcript index.
fn record_change(
    conn: &rusqlite::Connection,
    session_id: &str,
    id: &str,
    kind: &str,
) -> Result<()> {
    let revision: i64 = conn
        .prepare_cached(
            "INSERT INTO session_sync_state (session_id, revision) VALUES (?1, 1)
         ON CONFLICT(session_id) DO UPDATE SET revision = revision + 1 RETURNING revision",
        )?
        .query_row(params![session_id], |row| row.get(0))?;
    conn.prepare_cached(
        "INSERT INTO session_sync_changes (session_id, message_id, revision, kind)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(session_id, message_id) DO UPDATE SET
           revision = excluded.revision, kind = excluded.kind",
    )?
    .execute(params![session_id, id, revision, kind])?;
    Ok(())
}

pub(super) fn record_upsert(conn: &rusqlite::Connection, session_id: &str, id: &str) -> Result<()> {
    record_change(conn, session_id, id, "upsert")
}

/// A rewrite may reseat the whole search index; only changed content/positions
/// belong in the sync index. Otherwise regeneration would resend all history.
pub(super) fn record_replacement(
    conn: &rusqlite::Connection,
    session_id: &str,
    before: &[MessageRecord],
    after: &[MessageRecord],
) -> Result<()> {
    let previous: HashMap<&str, (usize, &MessageRecord)> = before
        .iter()
        .enumerate()
        .map(|(index, record)| (record.id.as_str(), (index, record)))
        .collect();
    let remaining: HashSet<&str> = after.iter().map(|record| record.id.as_str()).collect();
    for record in before {
        if !remaining.contains(record.id.as_str()) {
            record_change(conn, session_id, &record.id, "delete")?;
        }
    }
    for (sequence, record) in after.iter().enumerate() {
        let unchanged = match previous.get(record.id.as_str()) {
            Some((position, old)) => *position == sequence && *old == record,
            None => false,
        };
        if !unchanged {
            record_upsert(conn, session_id, &record.id)?;
        }
    }
    Ok(())
}

/// Resolve only the changed messages. A single reverse identity pass handles
/// duplicate physical lines using the same keep-last rule as normal history.
fn read_changed_records(
    db: &Database,
    session_id: &str,
    ids: HashSet<String>,
) -> Result<HashMap<String, MessageRecord>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    #[derive(Deserialize)]
    struct Identity {
        id: String,
    }
    let layout = session_layout(db, session_id)?;
    let mut reader = BufReader::new(File::open(transcripts::transcript_path(
        db.data_dir(),
        session_id,
    )?)?);
    let mut remaining = ids;
    let mut found = HashMap::new();
    let mut line = String::new();
    for offset in layout.message_offsets.iter().rev() {
        reader.seek(SeekFrom::Start(*offset))?;
        line.clear();
        reader.read_line(&mut line)?;
        let identity: Identity = serde_json::from_str(&line)?;
        if remaining.remove(&identity.id) {
            found.insert(identity.id, serde_json::from_str(&line)?);
            if remaining.is_empty() {
                break;
            }
        }
    }
    if !remaining.is_empty() {
        return Err(anyhow!(
            "transcript sync index references missing message content"
        ));
    }
    Ok(found)
}

pub fn list_session_changes(
    db: &Database,
    session_id: &str,
    after_revision: i64,
    limit: i64,
    content_limit: Option<usize>,
) -> Result<SessionChangesPage> {
    if session_summary(db, session_id)?.is_none() {
        return Err(anyhow!("NOT_FOUND: session not found"));
    }
    let head = session_sync_revision(db, session_id)?;
    if after_revision < 0 || after_revision > head || limit <= 0 {
        return Err(anyhow!(
            "INVALID_PARAMS: invalid transcript revision or page size"
        ));
    }
    let limit = limit.min(200) as usize;
    let mut stmt = db.conn().prepare_cached(
        "SELECT c.revision, c.message_id, c.kind, m.seq
         FROM session_sync_changes c LEFT JOIN messages m
           ON m.session_id = c.session_id AND m.id = c.message_id
         WHERE c.session_id = ?1 AND c.revision > ?2
         ORDER BY c.revision LIMIT ?3",
    )?;
    let mut rows = stmt
        .query_map(
            params![session_id, after_revision, (limit + 1) as i64],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let has_more = rows.len() > limit;
    rows.truncate(limit);
    let ids = rows
        .iter()
        .filter(|(_, _, kind, _)| kind == "upsert")
        .map(|(_, id, _, _)| id.clone())
        .collect();
    let mut records = read_changed_records(db, session_id, ids)?;
    let mut changes = Vec::with_capacity(rows.len());
    for (revision, message_id, kind, sequence) in rows {
        if kind == "delete" {
            changes.push(SessionChange::Delete {
                revision,
                message_id,
            });
        } else {
            let record = records
                .remove(&message_id)
                .ok_or_else(|| anyhow!("transcript sync message is missing"))?;
            let sequence =
                sequence.ok_or_else(|| anyhow!("transcript sync message has no index position"))?;
            let message = match content_limit {
                Some(limit) => record_to_ui_for_display(record, limit),
                None => record_to_ui(record),
            };
            changes.push(SessionChange::Upsert {
                revision,
                message_id,
                sequence,
                message: Box::new(message),
            });
        }
    }
    let revision = if has_more {
        changes
            .last()
            .map(SessionChange::revision)
            .unwrap_or(after_revision)
    } else {
        head
    };
    Ok(SessionChangesPage {
        session_id: session_id.into(),
        after_revision,
        revision,
        has_more,
        changes,
    })
}

#[cfg(test)]
mod tests;
