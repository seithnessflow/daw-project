// SPDX-License-Identifier: GPL-3.0-or-later
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
    /// AUDIT-5 F1: OPT-IN shared bearer token (env DAW_SERVER_TOKEN). When
    /// Some, the WS handshake requires an `auth:<token>` first message and
    /// /assets requires `Authorization: Bearer <token>`; when None (dev
    /// default) there is no auth (unchanged behaviour). Mirrors the engine's
    /// proven token model. Closes the C2-remote/F1 hole when the server is
    /// exposed by a tunnel: set the env var, and the URL's secret gates it.
    pub auth_token: Option<String>,
}

/// AUDIT-5 F1: constant-time byte comparison (the server had none). Length
/// leaks (it always would), the CONTENT does not. Mirrors the engine's
/// constantTimeEquals.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
