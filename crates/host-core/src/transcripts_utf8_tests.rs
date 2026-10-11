use super::*;
use serde_json::json;

const CREATED: &str = "2026-10-11T00:00:00Z";

fn message(id: &str, text: &str) -> MessageRecord {
    MessageRecord {
        id: id.into(),
        role: "assistant".into(),
        tool_name: None,
        is_error: false,
        blocks: json!([{ "type": "text", "text": text }]),
        meta: None,
        created_at: CREATED.into(),
    }
}

fn append_bytes(path: &Path, bytes: &[u8]) {
    OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(bytes)
        .unwrap();
}

fn assert_ids(messages: &[MessageRecord], expected: &[&str]) {
    assert_eq!(
        messages.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        expected
    );
}

#[test]
fn truncated_unicode_tail_does_not_hide_history_or_later_appends() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    for (index, character) in ["é", "中", "🦀"].iter().enumerate() {
        for cut in 1..character.len() {
            let id = format!("unicode-{index}-{cut}");
            append_message(dir, &id, CREATED, &message("before", "Valid 中文 🦀")).unwrap();
            let path = transcript_path(dir, &id).unwrap();
            let warm = refresh_layout(dir, &id, TranscriptLayout::default()).unwrap();
            let mut torn = br#"{"type":"message","id":"torn","text":""#.to_vec();
            torn.extend_from_slice(&character.as_bytes()[..cut]);
            append_bytes(&path, &torn);
            let original = fs::read(&path).unwrap();
            assert_ids(&read_transcript(dir, &id).unwrap(), &["before"]);
            assert!(!transcript_contains_id(dir, &id, "torn").unwrap());
            let partial = refresh_layout(dir, &id, warm).unwrap();
            assert_ids(
                &read_transcript_window_with_layout(dir, &id, &partial, 0, None)
                    .unwrap()
                    .messages,
                &["before"],
            );
            append_message(dir, &id, CREATED, &message("after", "Still valid 中文 🦀")).unwrap();
            let updated = refresh_layout(dir, &id, partial).unwrap();
            assert_ids(&read_transcript(dir, &id).unwrap(), &["before", "after"]);
            assert_ids(
                &read_transcript_window_with_layout(dir, &id, &updated, 1, Some(1))
                    .unwrap()
                    .messages,
                &["after"],
            );
            assert_eq!(
                find_message_position(dir, &id, &updated, "after").unwrap(),
                Some(1)
            );
            assert!(transcript_contains_id(dir, &id, "after").unwrap());
            assert_eq!(
                &fs::read(path).unwrap()[..original.len()],
                original.as_slice()
            );
        }
    }
}

#[test]
fn unicode_line_completed_by_writer_is_read_on_refresh() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    append_message(dir, "s", CREATED, &message("before", "ok")).unwrap();
    let path = transcript_path(dir, "s").unwrap();
    let mut line = tagged("message", &message("after", "中"))
        .unwrap()
        .into_bytes();
    line.push(b'\n');
    let split = line.windows(3).position(|w| w == "中".as_bytes()).unwrap() + 1;
    append_bytes(&path, &line[..split]);
    let partial = refresh_layout(dir, "s", TranscriptLayout::default()).unwrap();
    assert_eq!(partial.message_count(), 1);
    append_bytes(&path, &line[split..]);
    let complete = refresh_layout(dir, "s", partial).unwrap();
    assert_ids(
        &read_transcript_window_with_layout(dir, "s", &complete, 0, None)
            .unwrap()
            .messages,
        &["before", "after"],
    );
}

#[test]
fn indexed_reads_skip_invalid_unicode_without_losing_valid_tools() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    append_message(dir, "s", CREATED, &message("before", "ok")).unwrap();
    let path = transcript_path(dir, "s").unwrap();
    let bad_offset = fs::metadata(&path).unwrap().len();
    append_bytes(&path, b"{\"type\":\"message\",\"id\":\"bad\"}\xff\n");
    let mut tool = message("tool", "done");
    tool.role = "tool".into();
    tool.blocks = json!([{"type":"tool_call","callId":"call-1","output":"中文"}]);
    append_message(dir, "s", CREATED, &tool).unwrap();
    let mut layout = refresh_layout(dir, "s", TranscriptLayout::default()).unwrap();
    layout.message_offsets.push(bad_offset);
    assert_eq!(
        find_message_position(dir, "s", &layout, "before").unwrap(),
        Some(0)
    );
    assert!(read_tool_call(dir, "s", &layout, "call-1")
        .unwrap()
        .is_some());
    assert_ids(
        &read_transcript_window_with_layout(dir, "s", &layout, 0, None)
            .unwrap()
            .messages,
        &["before", "tool"],
    );
}

#[test]
fn revision_scan_survives_a_truncated_unicode_record() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    let path = revisions_path(dir, "s").unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let revision = RevisionRecord {
        root_user_id: "root".into(),
        revision_index: 0,
        created_at: CREATED.into(),
        turns: Default::default(),
        messages: vec![message("answer", "中文")],
    };
    append_line(&path, None, tagged("revision", &revision).unwrap()).unwrap();
    append_bytes(
        &path,
        b"{\"type\":\"revision\",\"rootUserId\":\"root\",\"text\":\"\xe4\xb8",
    );
    assert!(matches!(
        read_revision(dir, "s", "root", 0).unwrap(),
        Some(RevisionPayload::Stored(_))
    ));
    append_line(
        &path,
        None,
        tagged(
            "revision",
            &RevisionRecord {
                revision_index: 1,
                ..revision
            },
        )
        .unwrap(),
    )
    .unwrap();
    for index in 0..2 {
        assert!(matches!(
            read_revision(dir, "s", "root", index).unwrap(),
            Some(RevisionPayload::Stored(_))
        ));
    }
}

#[test]
fn metadata_update_preserves_unrelated_invalid_bytes_and_crlf() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    append_message(dir, "s", CREATED, &message("before", "original")).unwrap();
    let path = transcript_path(dir, "s").unwrap();
    let damaged = b"{\"type\":\"message\",\"id\":\"bad\"}\xff\r\n";
    append_bytes(&path, damaged);
    append_message(dir, "s", CREATED, &message("after", "last")).unwrap();
    let mut updated = message("before", "original");
    updated.meta = Some(json!({"status": "complete"}));
    assert!(update_message(dir, "s", &updated).unwrap());
    let raw = fs::read(&path).unwrap();
    assert!(raw.windows(damaged.len()).any(|window| window == damaged));
    let read = read_transcript(dir, "s").unwrap();
    assert_ids(&read, &["before", "after"]);
    assert_eq!(read[0].meta, updated.meta);
    assert!(update_message(dir, "s", &updated).unwrap());
    assert_eq!(fs::read(path).unwrap(), raw);
}
