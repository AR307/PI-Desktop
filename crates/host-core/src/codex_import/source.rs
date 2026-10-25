//! Stream Codex rollout segments without unpacking or changing the source.
use anyhow::Result;
use std::{
    fs::File,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

pub fn is_rollout(path: &Path) -> bool {
    path.to_str()
        .is_some_and(|name| name.ends_with(".jsonl") || name.ends_with(".jsonl.zst"))
}

pub fn reader(path: &Path) -> Result<Box<dyn BufRead>> {
    let file = File::open(path)?;
    if path.extension().is_some_and(|ext| ext == "zst") {
        Ok(Box::new(BufReader::new(zstd::stream::read::Decoder::new(
            file,
        )?)))
    } else {
        Ok(Box::new(BufReader::new(file)))
    }
}

pub fn existing_path(path: &Path) -> Option<PathBuf> {
    if path.is_file() {
        return Some(path.to_path_buf());
    }
    let compressed = PathBuf::from(format!("{}.zst", path.display()));
    compressed.is_file().then_some(compressed)
}

pub fn segment_id(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let stem = name
        .strip_suffix(".jsonl.zst")
        .or_else(|| name.strip_suffix(".jsonl"))?;
    let id = stem.get(stem.len().checked_sub(36)?..)?;
    uuid::Uuid::parse_str(id).ok().map(|_| id.to_owned())
}
