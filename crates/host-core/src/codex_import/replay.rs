//! Select surviving user turns before applying compaction checkpoints.
//! Tool results and steering input do not start new turns.
use serde_json::Value;

pub fn surviving_records(records: &[Value]) -> (Vec<&Value>, bool) {
    let is_start = |r: &Value| {
        r["type"] == "event_msg"
            && matches!(
                r["payload"]["type"].as_str(),
                Some("turn_started" | "task_started")
            )
    };
    let explicit = records.iter().any(is_start);
    let mut segments: Vec<(bool, Vec<&Value>)> = vec![(false, vec![])];
    let mut complete = true;
    let mut active_turn: Option<&str> = None;
    for record in records {
        let p = &record["payload"];
        if is_start(record) {
            active_turn = p["turn_id"].as_str();
        }
        if matches!(
            record["type"].as_str(),
            Some("response_item" | "retained_context" | "compacted")
        ) && p["turn_id"]
            .as_str()
            .zip(active_turn)
            .is_some_and(|(record_turn, active)| record_turn != active)
        {
            complete = false;
        }
        if record["type"] == "event_msg" && p["type"] == "thread_rolled_back" {
            let mut count = p["num_turns"].as_u64().unwrap_or(0);
            while count > 0 && !segments.is_empty() {
                if let Some((user, _)) = segments.pop() {
                    if user {
                        count -= 1;
                    }
                }
            }
            if count > 0 {
                complete = false;
            }
            segments.push((false, vec![]));
            continue;
        }
        let user =
            record["type"] == "response_item" && p["type"] == "message" && p["role"] == "user";
        let start = if explicit { is_start(record) } else { user };
        if start {
            segments.push((false, vec![]));
        }
        if let Some((has_user, items)) = segments.last_mut() {
            *has_user |= user || (record["type"] == "event_msg" && p["type"] == "user_message");
            items.push(record);
        }
    }
    (
        segments.into_iter().flat_map(|(_, items)| items).collect(),
        complete,
    )
}
