//! DAW Server Library
//!
//! Provides Automerge CRDT synchronization for the DAW project.

pub mod api;
pub mod document;
pub mod sync;

use tokio::sync::RwLock;

pub use document::ProjectStore;
pub use sync::SyncState;

/// Application state shared across handlers.
pub struct AppState {
    /// Project document store.
    pub store: Box<dyn ProjectStore + Send + Sync>,
    /// Active sync sessions.
    pub sync_state: RwLock<SyncState>,
}
