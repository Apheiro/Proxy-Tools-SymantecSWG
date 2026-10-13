use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BackupMode {
    Encrypted,
    Unencrypted,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub id: String,
    pub appliance: String,
    pub address: String,
    pub created_at: String,
    pub mode: BackupMode,
    pub mocked: bool,
    pub bytes: u64,
    pub warning: Option<String>,
}

pub fn new_id(appliance: &str) -> String {
    let name: String = appliance
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    format!(
        "backup-{}-{}",
        if name.is_empty() { "appliance" } else { &name },
        chrono::Utc::now().format("%Y%m%dT%H%M%S%.9fZ")
    )
}

pub fn path(root: &Path, id: &str, extension: &str) -> Result<PathBuf, String> {
    if !id.starts_with("backup-")
        || id.len() > 160
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        || id.contains("..")
    {
        return Err("Invalid backup identifier.".into());
    }
    Ok(root.join(format!("{id}.{extension}")))
}

pub fn publish(root: &Path, record: &BackupRecord) -> Result<(), String> {
    let output = path(root, &record.id, "txt")?;
    fs::rename(path(root, &record.id, "part")?, &output)
        .map_err(|e| format!("Could not finalize backup: {e}"))?;
    let metadata = path(root, &record.id, "json")?;
    let temporary = path(root, &record.id, "json.part")?;
    let result = (|| {
        let mut file = fs::File::create(&temporary)?;
        serde_json::to_writer(&mut file, record)?;
        file.sync_all()?;
        fs::rename(&temporary, &metadata)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&temporary);
        let _ = fs::remove_file(output);
        return Err(format!("Could not save backup metadata: {e}"));
    }
    Ok(())
}

pub fn list(root: &Path) -> Result<Vec<BackupRecord>, String> {
    let mut records = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("backup-") || !name.ends_with(".json") {
            continue;
        }
        let record: BackupRecord =
            serde_json::from_slice(&fs::read(entry.path()).map_err(|e| e.to_string())?)
                .map_err(|_| format!("Invalid backup metadata: {name}"))?;
        if let Ok(output) = path(root, &record.id, "txt") {
            if output.is_file() {
                records.push(record);
            }
        }
    }
    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(records)
}

pub fn read(root: &Path, id: &str) -> Result<String, String> {
    let _: BackupRecord =
        serde_json::from_slice(&fs::read(path(root, id, "json")?).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    fs::read_to_string(path(root, id, "txt")?)
        .map_err(|e| format!("Could not read complete backup: {e}"))
}

pub fn delete(root: &Path, id: &str) -> Result<(), String> {
    let metadata = path(root, id, "json")?;
    let output = path(root, id, "txt")?;
    let record: BackupRecord = serde_json::from_slice(
        &fs::read(&metadata).map_err(|e| format!("Could not locate backup: {e}"))?,
    )
    .map_err(|e| format!("Invalid backup metadata: {e}"))?;
    if record.id != id {
        return Err("Backup metadata does not match its identifier.".into());
    }
    match fs::remove_file(output) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Could not delete backup content: {e}")),
    }
    fs::remove_file(metadata)
        .map_err(|e| format!("Backup content was removed, but metadata cleanup failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_reject_traversal_and_publish_preserves_large_content() {
        let root = std::env::temp_dir().join(new_id("store-test"));
        fs::create_dir_all(&root).unwrap();
        for id in [
            "../backup-x",
            "backup-../../secret",
            "backup-a/b",
            "backup-a\\b",
        ] {
            assert!(path(&root, id, "txt").is_err());
        }
        let id = new_id("../appliance / name");
        let content = "!- configuración\r\n".repeat(100_000);
        fs::write(path(&root, &id, "part").unwrap(), &content).unwrap();
        let record = BackupRecord {
            id: id.clone(),
            appliance: "name".into(),
            address: "127.0.0.1".into(),
            created_at: chrono::Utc::now().to_rfc3339(),
            mode: BackupMode::Unencrypted,
            mocked: true,
            bytes: content.len() as u64,
            warning: None,
        };
        assert!(list(&root).unwrap().is_empty());
        publish(&root, &record).unwrap();
        assert_eq!(list(&root).unwrap().len(), 1);
        assert_eq!(read(&root, &id).unwrap(), content);
        let unrelated = root.join("rawLogs.log");
        fs::write(&unrelated, "keep trace").unwrap();
        assert!(delete(&root, "backup-../../rawLogs").is_err());
        assert!(delete(&root, "backup-missing").is_err());
        delete(&root, &id).unwrap();
        assert!(list(&root).unwrap().is_empty());
        assert!(!path(&root, &id, "txt").unwrap().exists());
        assert!(!path(&root, &id, "json").unwrap().exists());
        assert_eq!(fs::read_to_string(unrelated).unwrap(), "keep trace");
        fs::remove_dir_all(root).unwrap();
    }
}
