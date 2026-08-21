//! DAW Server Library
//!
//! Provides Automerge CRDT synchronization for the DAW project.

pub mod api;
pub mod document;
pub mod sync;

use tokio::sync::{Mutex, RwLock};

pub use document::ProjectStore;
pub use sync::SyncState;

/// Application state shared across handlers.
pub struct AppState {
    /// Project document store.
    pub store: Box<dyn ProjectStore + Send + Sync>,
    /// Active sync sessions.
    pub sync_state: RwLock<SyncState>,
    /// Serializes ALL store mutations (default-doc creation, apply_change).
    /// The store does unlocked load-modify-write on files: without this,
    /// two concurrent first connections both create the default document
    /// (the late save clobbers), and two concurrent changes can lose one.
    pub store_lock: Mutex<()>,
}
