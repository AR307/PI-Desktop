use crate::sessions::MessageAttachment;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub struct Blob {
    pub reference: String,
    pub bytes: Vec<u8>,
}
pub struct ImportedAttachments {
    pub attachments: Vec<MessageAttachment>,
    pub images: Vec<Value>,
    pub blobs: Vec<Blob>,
    pub warnings: Vec<String>,
}
pub fn read(content: &Value, source: &Path, cwd: Option<&str>) -> ImportedAttachments {
    let mut result = ImportedAttachments {
        attachments: vec![],
        images: vec![],
        blobs: vec![],
        warnings: vec![],
    };
    let Some(parts) = content.as_array() else {
        return result;
    };
    for part in parts {
        let kind = part["type"].as_str().unwrap_or("");
        if matches!(kind, "input_text" | "output_text" | "text" | "summary_text") {
            continue;
        }
        if !matches!(kind, "input_image" | "image" | "localImage" | "input_file") {
            result.warnings.push(format!(
                "Unsupported content part was not restored into model context: {kind}"
            ));
            continue;
        }
        let reference = part["image_url"]
            .as_str()
            .or_else(|| part["image_url"]["url"].as_str())
            .or_else(|| part["url"].as_str())
            .or_else(|| part["path"].as_str())
            .or_else(|| part["file_data"].as_str());
        let Some(reference) = reference else {
            result
                .warnings
                .push("Attachment has no recoverable local reference".into());
            continue;
        };
        let loaded = if let Some(data) = reference.strip_prefix("data:") {
            data.split_once(";base64,").and_then(|(mime, bytes)| {
                STANDARD
                    .decode(bytes)
                    .ok()
                    .map(|bytes| (mime.to_string(), bytes, "Codex attachment".to_string()))
            })
        } else if reference.starts_with("http:") || reference.starts_with("https:") {
            None
        } else {
            let path = PathBuf::from(reference);
            let path = if path.is_absolute() {
                path
            } else {
                cwd.map(Path::new).unwrap_or(source).join(path)
            };
            let resolved = path.canonicalize().ok();
            if resolved.as_ref().is_some_and(|path| {
                source
                    .canonicalize()
                    .ok()
                    .is_some_and(|root| path.starts_with(root))
                    && path.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                        matches!(
                            n.to_ascii_lowercase().as_str(),
                            "auth.json" | "credentials.json" | "config.toml"
                        )
                    })
            }) {
                result.warnings.push("Codex credential and account configuration files are never imported as attachments".into());
                continue;
            }
            let allowed = resolved.as_ref().is_some_and(|path| {
                std::iter::once(source)
                    .chain(cwd.map(Path::new))
                    .filter_map(|root| root.canonicalize().ok())
                    .any(|root| path.starts_with(root))
            });
            if !allowed {
                result.warnings.push("Attachment lies outside the selected source and project directories; it was not read".into());
                continue;
            }
            let mime = match path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase()
                .as_str()
            {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                "gif" => "image/gif",
                "pdf" => "application/pdf",
                _ => "application/octet-stream",
            };
            fs::read(&path).ok().map(|bytes| {
                (
                    mime.to_string(),
                    bytes,
                    path.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                )
            })
        };
        let Some((mime, bytes, name)) = loaded else {
            result.warnings.push(
                "Attachment is missing or requires a remote download; it was not restored".into(),
            );
            continue;
        };
        let reference = format!("attachments/{}", hex::encode(Sha256::digest(&bytes)));
        if mime.starts_with("image/") {
            result
                .images
                .push(json!({"type":"image","mimeType":mime,"data":STANDARD.encode(&bytes)}));
        } else {
            result.warnings.push(format!("File attachment {name} is preserved for viewing; its original model representation is unavailable"));
        }
        result.attachments.push(MessageAttachment {
            kind: if mime.starts_with("image/") {
                "image"
            } else {
                "file"
            }
            .into(),
            name,
            reference: reference.clone(),
            mime_type: Some(mime),
            size: Some(bytes.len() as i64),
            text: None,
            inline_path: None,
        });
        result.blobs.push(Blob { reference, bytes });
    }
    result
}
