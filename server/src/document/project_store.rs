//! Project storage trait.

use anyhow::Result;
use async_trait::async_trait;

/// Trait for project document persistence.
///
/// This abstraction allows swapping file-based storage for a database later.
#[async_trait]
pub trait ProjectStore {
    /// Load a project document.
    ///
    /// Returns the full Automerge document as bytes, or None if not found.
    async fn load(&self, project_id: &str) -> Result<Option<Vec<u8>>>;

    /// Save a project document.
    ///
    /// Overwrites any existing document.
    async fn save(&self, project_id: &str, data: &[u8]) -> Result<()>;

    /// Apply a change to an existing document.
    ///
    /// The change is merged with the existing document.
    async fn apply_change(&self, project_id: &str, change: &[u8]) -> Result<()>;

    /// List all project IDs.
    async fn list(&self) -> Result<Vec<String>>;

    /// Delete a project.
    async fn delete(&self, project_id: &str) -> Result<()>;
}
