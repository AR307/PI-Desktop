use super::{
    catalog::{Candidate, Catalog},
    same_path,
};
use crate::db::Database;
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::path::Path;

pub fn mapped_directory(path: Option<&str>, mappings: &Value) -> Result<Option<String>> {
    let Some(path) = path else { return Ok(None) };
    if let Some(roots) = mappings.as_object() {
        let mut roots: Vec<_> = roots.iter().collect();
        roots.sort_by_key(|(root, _)| std::cmp::Reverse(root.len()));
        for (root, target) in roots {
            let suffix = if same_path(root, path) {
                Some(Path::new(""))
            } else {
                Path::new(path).strip_prefix(root).ok()
            };
            if let Some(suffix) = suffix {
                return match target {
                    Value::Null => Ok(None),
                    Value::String(target) => Ok(Some(
                        Path::new(target)
                            .join(suffix)
                            .to_string_lossy()
                            .into_owned(),
                    )),
                    _ => Err(anyhow!("Invalid directory mapping")),
                };
            }
        }
    }
    Ok(Some(path.into()))
}

/// A source identity, not its display name, owns the repeated-import mapping.
pub fn bind(
    db: &Database,
    catalog: &Catalog,
    candidate: &Candidate,
    path: Option<&str>,
    target: Option<&str>,
    mappings: &Value,
) -> Result<()> {
    let Some(path) = path else { return Ok(()) };
    if let Some(target) = target {
        let group = db
            .list_project_groups()?
            .into_iter()
            .find(|g| g.id == target)
            .ok_or_else(|| anyhow!("Target project does not exist"))?;
        if !group.roots.iter().any(|r| same_path(&r.path, path)) {
            return Err(anyhow!(
                "Choose a working directory belonging to the selected target project"
            ));
        }
        return Ok(());
    }
    let Some(project) = catalog
        .projects
        .iter()
        .find(|p| Some(&p.id) == candidate.project_id.as_ref())
    else {
        return Ok(());
    };
    let mut roots = vec![];
    for root in &project.roots {
        let mapped = match mappings.get(root) {
            Some(Value::Null) => continue,
            Some(Value::String(value)) => value,
            Some(_) => return Err(anyhow!("Invalid project root mapping")),
            None => root,
        };
        if !Path::new(mapped).is_dir() {
            return Err(anyhow!(
                "A project root is missing; rebind it or explicitly leave it unbound: {mapped}"
            ));
        }
        if !roots.iter().any(|p: &String| same_path(p, mapped)) {
            roots.push(mapped.clone());
        }
    }
    if !roots.iter().any(|p| same_path(p, path)) {
        roots.push(path.into());
    }
    let key = format!("{}:{}", catalog.root.display(), project.id);
    if let Some(id) = db
        .kv_get("codexImportProjects", &key)?
        .and_then(|v| v.as_str().map(str::to_owned))
    {
        if let Some(group) = db.list_project_groups()?.into_iter().find(|g| g.id == id) {
            let mut combined: Vec<_> = group.roots.iter().map(|r| r.path.clone()).collect();
            for root in roots {
                if !combined.iter().any(|p| same_path(p, &root)) {
                    combined.push(root);
                }
            }
            db.update_project_group(&id, &group.name, &combined, None)?;
            return Ok(());
        }
    }
    if let Some(group) = db.stored_project_group_for_path(path)? {
        let mut combined: Vec<_> = group.roots.iter().map(|r| r.path.clone()).collect();
        for root in roots {
            if !combined.iter().any(|p| same_path(p, &root)) {
                combined.push(root);
            }
        }
        db.update_project_group(&group.id, &group.name, &combined, None)?;
        db.kv_set("codexImportProjects", &key, &Value::String(group.id))?;
        return Ok(());
    }
    for root in &roots {
        if db.stored_project_group_for_path(root)?.is_some() {
            return Err(anyhow!("A source root already belongs to a PI project; explicitly choose its target project"));
        }
    }
    let group = db.create_project_group(&project.name, &roots)?;
    db.kv_set("codexImportProjects", &key, &Value::String(group.id))?;
    Ok(())
}
