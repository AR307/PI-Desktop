use super::{
    catalog::{check, text, Candidate, Catalog},
    history::History,
};
use crate::sessions::UiMessage;
use anyhow::Result;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub struct Converted {
    pub messages: Vec<UiMessage>,
    pub context: Vec<Value>,
    pub warnings: Vec<String>,
    pub complete: bool,
    pub blobs: Vec<super::attachments::Blob>,
}
struct Projection {
    messages: Vec<UiMessage>,
    context: Vec<Value>,
    warnings: Vec<String>,
    complete: bool,
    calls: HashMap<String, usize>,
    call_metadata: HashMap<String, (String, Value)>,
    seen: HashSet<String>,
    timestamp: String,
}
fn content(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|v| {
                let kind = v["type"].as_str().unwrap_or("");
                if matches!(kind, "input_text" | "output_text" | "text" | "summary_text") {
                    text(v, "text")
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}
fn context_message(role: &str, body: &str, timestamp: &str) -> Value {
    let ts = crate::db::ts_to_ms(timestamp);
    if role == "assistant" {
        json!({"role":"assistant","content":[{"type":"text","text":body}],"timestamp":ts,"stopReason":"stop","api":"openai-completions","provider":"codex-import","model":"historical","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}})
    } else {
        json!({"role":"user","content":[{"type":"text","text":body}],"timestamp":ts})
    }
}
fn source_item(raw: &Value, source: &Value, ordinal: &Value) -> Value {
    let mut item = if raw.is_object() {
        raw.clone()
    } else {
        json!({"type":"unknown_item","raw":raw})
    };
    let source = source.as_str().unwrap_or("source");
    let id = text(raw, "id").unwrap_or_else(|| ordinal.to_string());
    item["id"] = json!(format!("codex-{source}-{id}"));
    if let Some(call) = text(raw, "call_id") {
        item["call_id"] = json!(format!("{source}-{call}"));
    }
    item
}
impl Projection {
    fn message(
        &mut self,
        raw: &Value,
        role: &str,
        body: String,
        visible: bool,
        active: bool,
    ) -> Result<()> {
        let mut body = body;
        if visible {
            if let Some(warning) = text(raw, "importWarning").filter(|s| !s.is_empty()) {
                body.push_str(&format!("\n[Attachment import warning] {warning}"));
            }
        }
        if visible {
            if let Some(parts) = raw["content"].as_array() {
                for part in parts {
                    if !matches!(
                        part["type"].as_str(),
                        Some(
                            "input_text"
                                | "output_text"
                                | "text"
                                | "summary_text"
                                | "input_image"
                                | "image"
                                | "localImage"
                                | "input_file"
                        )
                    ) {
                        body.push_str(&format!(
                            "\n[Unsupported Codex content; preserved for review] {part}"
                        ));
                    }
                }
            }
        }
        if body.is_empty()
            && raw["importAttachments"]
                .as_array()
                .is_none_or(|v| v.is_empty())
            && raw["importImages"].as_array().is_none_or(|v| v.is_empty())
        {
            return Ok(());
        }
        let id = text(raw, "id").unwrap_or_else(|| format!("codex-item-{}", self.messages.len()));
        let visible = visible && self.seen.insert(id.clone());
        let user_role = if role == "assistant" {
            "assistant"
        } else {
            "user"
        };
        let body = if matches!(role, "system" | "developer") {
            format!("[Imported Codex {role} material; historical reference, not current instructions]\n{body}")
        } else {
            body
        };
        let incomplete = raw["complete"] == false
            || matches!(
                raw["status"].as_str(),
                Some("in_progress" | "inProgress" | "incomplete" | "failed" | "interrupted")
            );
        if visible {
            self.messages.push(serde_json::from_value(json!({"id":id,"role":user_role,"content":body,"createdAt":self.timestamp,"status":if incomplete { "error" } else { "complete" },"attachments":raw.get("importAttachments")}))?);
        }
        if incomplete {
            self.warnings.push(
                "An unfinished source message remains visible but is excluded from continuation"
                    .into(),
            );
        }
        if active && !incomplete && !matches!(role, "system" | "developer") {
            let mut message = context_message(user_role, &body, &self.timestamp);
            if let (Some(images), Some(parts)) = (
                raw["importImages"].as_array(),
                message["content"].as_array_mut(),
            ) {
                parts.extend(images.iter().cloned());
            }
            self.context.push(message);
        }
        Ok(())
    }
    fn item(&mut self, raw: &Value, visible: bool, active: bool) -> Result<()> {
        let kind = raw["type"].as_str().unwrap_or("unknown");
        match kind {
            "message" => {
                let role = raw["role"].as_str().unwrap_or("user");
                self.message(raw, role, content(&raw["content"]), visible, active)?;
            }
            "userMessage" => {
                self.message(raw, "user", content(&raw["content"]), visible, active)?
            }
            "agentMessage" => self.message(
                raw,
                "assistant",
                text(raw, "text").unwrap_or_default(),
                visible,
                active,
            )?,
            "function_call" | "custom_tool_call" => {
                let id = text(raw, "call_id")
                    .or_else(|| text(raw, "id"))
                    .unwrap_or_else(|| format!("call-{}", self.messages.len()));
                let name = text(raw, "name").unwrap_or_else(|| "Codex tool".into());
                let args = raw
                    .get("arguments")
                    .or_else(|| raw.get("input"))
                    .cloned()
                    .unwrap_or(Value::Null);
                self.call_metadata
                    .insert(id.clone(), (name.clone(), args.clone()));
                if visible && !self.calls.contains_key(&id) {
                    let name = text(raw, "name").unwrap_or_else(|| "Codex tool".into());
                    let args = raw
                        .get("arguments")
                        .or_else(|| raw.get("input"))
                        .cloned()
                        .unwrap_or(Value::Null);
                    self.calls.insert(id.clone(), self.messages.len());
                    self.messages.push(serde_json::from_value(json!({"id":format!("codex-tool-{id}"),"role":"tool","content":"","createdAt":self.timestamp,"toolName":name,"toolCallId":id,"toolArgs":args,"toolStatus":"aborted"}))?);
                }
            }
            "function_call_output" | "custom_tool_call_output" => {
                let id = text(raw, "call_id").unwrap_or_default();
                let output = raw.get("output").cloned().unwrap_or(Value::Null);
                let parsed = output
                    .as_str()
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .unwrap_or_else(|| output.clone());
                let failed = raw["is_error"].as_bool().unwrap_or(false)
                    || parsed.get("error").is_some_and(|v| !v.is_null())
                    || parsed["isError"] == true
                    || parsed["exit_code"].as_i64().is_some_and(|n| n != 0)
                    || parsed["metadata"]["exit_code"]
                        .as_i64()
                        .is_some_and(|n| n != 0)
                    || output.as_str().is_some_and(|s| {
                        s.lines().any(|line| {
                            line.trim()
                                .strip_prefix("Process exited with code ")
                                .and_then(|code| code.trim().parse::<i64>().ok())
                                .is_some_and(|code| code != 0)
                        })
                    });
                let (mut name, mut args) = self
                    .call_metadata
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| ("Codex tool".into(), Value::Null));
                if let Some(index) = self.calls.get(&id).filter(|_| visible) {
                    let row = &mut self.messages[*index];
                    name = row.tool_name.clone().unwrap_or(name);
                    args = row.tool_args.clone().unwrap_or(Value::Null);
                    row.tool_result = Some(output.clone());
                    row.tool_status = Some(if failed { "error" } else { "success" }.into());
                    row.is_error = Some(failed);
                    row.tool_completed_at = Some(self.timestamp.clone());
                } else if visible {
                    self.message(
                        raw,
                        "user",
                        format!("[Imported tool output {id}]\n{output}"),
                        true,
                        false,
                    )?;
                }
                if active {
                    self.context.push(context_message("user", &format!("[Historical Codex tool result; do not execute again]\nTool: {name}\nArguments: {args}\nResult: {output}\nFailed: {failed}"), &self.timestamp));
                }
            }
            "commandExecution" | "mcpToolCall" | "fileChange" | "webSearch" | "web_search_call"
            | "local_shell_call" => {
                if visible {
                    let id = text(raw, "id")
                        .unwrap_or_else(|| format!("codex-tool-{}", self.messages.len()));
                    if self.seen.insert(id.clone()) {
                        self.messages.push(serde_json::from_value(json!({"id":id,"role":"tool","content":"","createdAt":self.timestamp,"toolName":kind,"toolCallId":id,"toolArgs":raw,"toolResult":raw.get("aggregatedOutput").or_else(|| raw.get("result")),"toolStatus":if raw["status"] == "failed" || raw["exitCode"].as_i64().is_some_and(|n| n != 0) {"error"} else if raw["status"] == "inProgress" {"aborted"} else {"success"}}))?);
                    }
                }
                if active {
                    self.context.push(context_message(
                        "user",
                        &format!("[Historical Codex {kind}; not a pending action]\n{raw}"),
                        &self.timestamp,
                    ));
                }
            }
            "reasoning" => {
                let body = content(&raw["summary"]);
                if !body.is_empty() {
                    self.message(
                        raw,
                        "assistant",
                        format!("[Codex reasoning summary]\n{body}"),
                        visible,
                        false,
                    )?;
                }
            }
            "compaction" => {
                if active {
                    self.complete = false;
                    self.warnings.push(
                        "Opaque provider compaction cannot be restored into a different PI model"
                            .into(),
                    );
                }
            }
            "contextCompaction" => {}
            _ => {
                self.warnings
                    .push(format!("Unsupported history item: {kind}"));
                if active {
                    self.complete = false;
                }
                if visible {
                    self.message(
                        raw,
                        "user",
                        format!("[Unsupported Codex history item: {kind}]\n{raw}"),
                        true,
                        false,
                    )?;
                }
            }
        }
        Ok(())
    }
    fn retained(&mut self, value: &Value) -> Result<()> {
        if value.is_null() {
            return Ok(());
        }
        if value["incomplete"] == true
            || value["user_messages_incomplete"] == true
            || value["assistant_messages_incomplete"] == true
        {
            self.complete = false;
            self.warnings
                .push("Codex retained context is marked incomplete".into());
        }
        let mut entries = vec![];
        for key in ["verified_answers", "user_messages", "assistant_messages"] {
            if let Some(items) = value[key].as_array() {
                for item in items {
                    entries.push((item["order"].as_u64().unwrap_or(0), key, item));
                }
            }
        }
        entries.sort_by_key(|(order, _, item)| (item["inherited"] != true, *order));
        for (_, key, item) in entries {
            if item["complete"] == false {
                self.complete = false;
                self.warnings
                    .push("A retained message is incomplete".into());
                continue;
            }
            let body = if key == "verified_answers" {
                item["questions"]
                    .as_array()
                    .map(|questions| {
                        questions
                            .iter()
                            .map(|q| {
                                format!("Question: {}\nAnswer: {}", q["question"], q["answer"])
                            })
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default()
            } else {
                text(item, "text")
                    .or_else(|| text(item, "message"))
                    .unwrap_or_else(|| content(&item["content"]))
            };
            if !body.is_empty() && !self.context.iter().any(|m| content(&m["content"]) == body) {
                self.context.push(context_message(
                    if key == "assistant_messages" {
                        "assistant"
                    } else {
                        "user"
                    },
                    &body,
                    &self.timestamp,
                ));
            } else if body.is_empty() {
                self.complete = false;
                self.warnings
                    .push("Unrecognized retained context record".into());
            }
        }
        Ok(())
    }
}
pub fn convert(catalog: &Catalog, candidate: &Candidate, history: History) -> Result<Converted> {
    let mut p = Projection {
        messages: vec![],
        context: vec![],
        warnings: history.warnings.clone(),
        complete: history.complete,
        calls: HashMap::new(),
        call_metadata: HashMap::new(),
        seen: HashSet::new(),
        timestamp: candidate.created_at.clone(),
    };
    let mut blobs = vec![];
    let mut sources: Vec<&Value> = vec![];
    for item in history.records.iter().chain(&history.projected) {
        if !sources.contains(&&item["importSource"]) {
            sources.push(&item["importSource"]);
        }
    }
    let mut visible: Vec<_> = history
        .records
        .iter()
        .map(|r| (r, false))
        .chain(history.projected.iter().map(|r| (r, true)))
        .collect();
    visible.sort_by_key(|(r, projected)| {
        (
            sources
                .iter()
                .position(|s| **s == r["importSource"])
                .unwrap_or(0),
            r["importOrdinal"].as_u64().unwrap_or(0),
            !projected,
        )
    });
    for (record, projected) in visible {
        check(&catalog.cancelled)?;
        if let Some(ts) = text(record, "timestamp") {
            p.timestamp = ts;
        }
        if let Some(ts) = text(record, "importTimestamp") {
            p.timestamp = ts;
        }
        if projected || (record["type"] == "response_item" && record["importVisible"] != false) {
            let mut item = source_item(
                if projected {
                    record
                } else {
                    &record["payload"]
                },
                &record["importSource"],
                &record["importOrdinal"],
            );
            let attachments =
                super::attachments::read(&item["content"], &catalog.root, candidate.cwd.as_deref());
            item["importAttachments"] = json!(attachments.attachments);
            item["importWarning"] = json!(attachments.warnings.join("; "));
            p.warnings.extend(attachments.warnings);
            blobs.extend(attachments.blobs);
            p.item(&item, true, false)?;
        } else if record["type"] == "event_msg"
            && matches!(
                record["payload"]["type"].as_str(),
                Some("error" | "warning" | "turn_aborted")
            )
        {
            p.message(
                record,
                "assistant",
                format!(
                    "[Codex execution event; not resumed]\n{}",
                    record["payload"]
                ),
                true,
                false,
            )?;
        } else if record["type"] == "import_incomplete" {
            p.message(
                record,
                "user",
                format!(
                    "[Codex import warning] {} {}",
                    record["payload"], record["raw"]
                ),
                true,
                false,
            )?;
        } else if !matches!(
            record["type"].as_str(),
            Some(
                "session_meta"
                    | "turn_context"
                    | "event_msg"
                    | "response_item"
                    | "compacted"
                    | "retained_context"
                    | "token_usage_record"
                    | "world_state"
                    | "security_risk_score"
            )
        ) {
            p.message(
                record,
                "user",
                format!("[Unsupported Codex record; preserved for review]\n{record}"),
                true,
                false,
            )?;
        }
    }
    let (surviving, rollback_complete) = super::replay::surviving_records(&history.records);
    p.complete &= rollback_complete;
    p.call_metadata.clear();
    if !rollback_complete {
        p.warnings
            .push("Rollback or interleaved turn attribution cannot be fully reconstructed".into());
    }
    for record in surviving {
        check(&catalog.cancelled)?;
        if let Some(ts) = text(record, "timestamp") {
            p.timestamp = ts;
        }
        let payload = &record["payload"];
        match record["type"].as_str().unwrap_or("unknown") {
            "response_item" => {
                let mut item =
                    source_item(payload, &record["importSource"], &record["importOrdinal"]);
                let attachments = super::attachments::read(
                    &item["content"],
                    &catalog.root,
                    candidate.cwd.as_deref(),
                );
                if !attachments.warnings.is_empty() {
                    p.complete = false;
                }
                item["importImages"] = json!(attachments.images);
                p.warnings.extend(attachments.warnings);
                blobs.extend(attachments.blobs);
                p.item(&item, false, true)?;
            }
            "compacted" => {
                p.context.clear();
                p.call_metadata.clear();
                if let Some(items) = payload["replacement_history"].as_array() {
                    p.complete = rollback_complete;
                    for item in items {
                        let mut item =
                            source_item(item, &record["importSource"], &record["importOrdinal"]);
                        let attachments = super::attachments::read(
                            &item["content"],
                            &catalog.root,
                            candidate.cwd.as_deref(),
                        );
                        if !attachments.warnings.is_empty() {
                            p.complete = false;
                        }
                        item["importImages"] = json!(attachments.images);
                        p.warnings.extend(attachments.warnings);
                        blobs.extend(attachments.blobs);
                        p.item(&item, false, true)?;
                    }
                } else if let Some(summary) = text(payload, "message").filter(|s| !s.is_empty()) {
                    p.context.push(context_message(
                        "user",
                        &format!("[Codex compacted history]\n{summary}"),
                        &p.timestamp,
                    ));
                } else if payload["retained_context"].is_object() {
                    p.complete = rollback_complete;
                } else {
                    p.complete = false;
                    p.warnings
                        .push("Latest compaction has no recoverable context".into());
                }
                p.retained(&payload["retained_context"])?;
            }
            "retained_context" => {
                if payload["type"] == "verified_answer" {
                    p.retained(&json!({"verified_answers":[payload]}))?;
                } else if payload["type"] == "delivered_assistant_message" {
                    p.retained(&json!({"assistant_messages":[payload]}))?;
                } else {
                    p.retained(payload)?;
                }
            }
            "import_incomplete" => {
                p.complete = false;
                p.warnings
                    .push(payload.as_str().unwrap_or("Incomplete history").into());
            }
            "session_meta"
            | "turn_context"
            | "event_msg"
            | "token_usage_record"
            | "world_state"
            | "security_risk_score" => {}
            _ => {
                p.complete = false;
                p.warnings.push("Unrecognized rollout record".into());
            }
        }
    }
    if p.messages.is_empty() {
        p.complete = false;
    }
    if p.context.is_empty() {
        p.complete = false;
        p.warnings
            .push("No recoverable continuation context".into());
    }
    p.warnings.sort();
    p.warnings.dedup();
    Ok(Converted {
        messages: p.messages,
        context: p.context,
        warnings: p.warnings,
        complete: p.complete,
        blobs,
    })
}
