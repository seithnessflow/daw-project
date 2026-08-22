// SPDX-License-Identifier: GPL-3.0-or-later
//! File-based project storage.

use anyhow::{Context, Result};
use async_trait::async_trait;
use automerge::Automerge;
use std::path::PathBuf;
use tokio::fs;

use super::ProjectStore;

/// File-based project store.
///
/// Stores each project as a separate file in a directory.
pub struct FileStore {
    base_path: PathBuf,
}

impl FileStore {
    /// Create a new file store.
    pub fn new(base_path: impl Into<PathBuf>) -> Result<Self> {
        let path = base_path.into();
        std::fs::create_dir_all(&path)
            .with_context(|| format!("Failed to create store directory: {:?}", path))?;
        Ok(Self { base_path: path })
    }

    /// Defense in depth (audit C1): even though the ws handler validates,
    /// the store REFUSES a non-stem id rather than join it - a traversal
    /// segment must never reach the filesystem. Callers already handle
    /// the error path (load/save/apply_change return Result).
    fn project_path(&self, project_id: &str) -> Result<PathBuf> {
        let ok = !project_id.is_empty()
            && project_id.len() <= 64
            && project_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if !ok {
            anyhow::bail!("invalid project id: {:?}", project_id);
        }
        Ok(self.base_path.join(format!("{}.am", project_id)))
    }
}

/// Write via temp file + atomic rename: fs::write truncates in place, so a
/// crash mid-write would leave a truncated, unloadable project file.
async fn write_atomic(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("am.tmp");
    fs::write(&tmp, data).await?;
    fs::rename(&tmp, path).await
}

#[async_trait]
impl ProjectStore for FileStore {
    async fn load(&self, project_id: &str) -> Result<Option<Vec<u8>>> {
        let path = self.project_path(project_id)?;

        if !path.exists() {
            return Ok(None);
        }

        let data = fs::read(&path)
            .await
            .with_context(|| format!("Failed to read project: {}", project_id))?;

        Ok(Some(data))
    }

    async fn save(&self, project_id: &str, data: &[u8]) -> Result<()> {
        let path = self.project_path(project_id)?;

        write_atomic(&path, data)
            .await
            .with_context(|| format!("Failed to write project: {}", project_id))?;

        Ok(())
    }

    async fn apply_change(&self, project_id: &str, change: &[u8]) -> Result<()> {
        let path = self.project_path(project_id)?;

        // Load existing or create new
        let mut doc = if path.exists() {
            let data = fs::read(&path).await?;
            Automerge::load(&data)?
        } else {
            Automerge::new()
        };

        // Apply the change
        doc.load_incremental(change)?;

        // Save back (atomic: same guarantee as save())
        let data = doc.save();
        write_atomic(&path, &data).await?;

        Ok(())
    }

    async fn list(&self) -> Result<Vec<String>> {
        let mut projects = Vec::new();

        let mut entries = fs::read_dir(&self.base_path).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().map(|e| e == "am").unwrap_or(false) {
                if let Some(stem) = path.file_stem() {
                    if let Some(name) = stem.to_str() {
                        projects.push(name.to_string());
                    }
                }
            }
        }

        Ok(projects)
    }

    async fn delete(&self, project_id: &str) -> Result<()> {
        let path = self.project_path(project_id)?;

        if path.exists() {
            fs::remove_file(&path)
                .await
                .with_context(|| format!("Failed to delete project: {}", project_id))?;
        }

        Ok(())
    }
}
