// SPDX-License-Identifier: GPL-3.0-or-later
//! File-based project storage.

use anyhow::{Context, Result};
use async_trait::async_trait;
use automerge::{Automerge, ReadDoc};
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

        // Load existing, or start from the SEED (A4-3: a change for a
        // brand-new project can only be seed-rooted; an empty doc would
        // reject it as missing-deps below, which is the point)
        let mut doc = if path.exists() {
            let data = fs::read(&path).await?;
            Automerge::load(&data)?
        } else {
            Automerge::load(super::SEED_DOC)?
        };

        // A4-1: automerge-rs queues a change whose dependencies are
        // missing WITHOUT error - "Ok" here used to mean "silently
        // dropped, then broadcast anyway". Refuse loudly instead; the
        // caller must NOT broadcast a change the disk does not hold.
        // DELTA, not absolute: documents scarred by the pre-guard era
        // carry historical missing deps forever - only a change that
        // ADDS missing deps (its own deps absent) is the Lagged case.
        let missing_before = doc.get_missing_deps(&[]).len();

        // Apply the change
        doc.load_incremental(change)?;

        let missing = doc.get_missing_deps(&[]);
        if missing.len() > missing_before {
            anyhow::bail!(
                "change refused: {} missing dependenc{} (out-of-order delivery or foreign root)",
                missing.len() - missing_before,
                if missing.len() - missing_before == 1 { "y" } else { "ies" }
            );
        }

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::ProjectStore;
    use automerge::{transaction::Transactable, AutoCommit, ROOT};

    /// A4-1 guard: the exact Lagged/skip scenario. A change whose
    /// dependency was never delivered must be REFUSED (bail), never
    /// silently queued-then-dropped-then-"Ok". In order, it applies.
    #[tokio::test]
    async fn apply_change_refuses_missing_deps() {
        let dir = std::env::temp_dir().join("daw-store-a41-test");
        let _ = std::fs::remove_dir_all(&dir);
        let store = FileStore::new(&dir).unwrap();

        // Seed-rooted doc, then two dependent changes c1 -> c2
        let mut doc = AutoCommit::load(super::super::SEED_DOC).unwrap();
        let heads0 = doc.get_heads();
        doc.put(ROOT, "sampleRate", 44100i64).unwrap();
        let heads1 = doc.get_heads();
        doc.put(ROOT, "sampleRate", 96000i64).unwrap();
        let heads2 = doc.get_heads();
        let c1 = doc.get_change_by_hash(&heads1[0]).unwrap().raw_bytes().to_vec();
        let c2 = doc.get_change_by_hash(&heads2[0]).unwrap().raw_bytes().to_vec();
        assert_ne!(heads0, heads1);

        // Out of order: c2 alone (its dep c1 was "skipped") -> refusal
        let err = store.apply_change("a41", &c2).await;
        assert!(err.is_err(), "missing-dep change must be refused");
        assert!(format!("{}", err.unwrap_err()).contains("missing dependenc"));

        // In order: c1 then c2 both apply, document holds the final value
        store.apply_change("a41", &c1).await.unwrap();
        store.apply_change("a41", &c2).await.unwrap();
        let stored = store.load("a41").await.unwrap().unwrap();
        let stored_doc = Automerge::load(&stored).unwrap();
        let (value, _) = stored_doc.get(ROOT, "sampleRate").unwrap().unwrap();
        assert_eq!(value.to_i64().unwrap(), 96000);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A4-3 guard: a change made on the vendored seed applies to a
    /// BRAND-NEW project (no file on disk) - the store starts from the
    /// seed, not from an empty doc that would reject everything.
    #[tokio::test]
    async fn apply_change_seeds_new_project() {
        let dir = std::env::temp_dir().join("daw-store-a43-test");
        let _ = std::fs::remove_dir_all(&dir);
        let store = FileStore::new(&dir).unwrap();

        let mut doc = AutoCommit::load(super::super::SEED_DOC).unwrap();
        doc.put(ROOT, "masterGain", 0.5f64).unwrap();
        let heads = doc.get_heads();
        let c = doc.get_change_by_hash(&heads[0]).unwrap().raw_bytes().to_vec();

        store.apply_change("a43", &c).await.unwrap();
        let stored = store.load("a43").await.unwrap().unwrap();
        let stored_doc = Automerge::load(&stored).unwrap();
        let (value, _) = stored_doc.get(ROOT, "masterGain").unwrap().unwrap();
        assert_eq!(value.to_f64().unwrap(), 0.5);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
