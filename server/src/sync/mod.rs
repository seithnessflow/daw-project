//! Sync session management.

use std::collections::HashMap;
use tokio::sync::broadcast;
use uuid::Uuid;

/// Manages active sync sessions.
pub struct SyncState {
    /// Broadcast channels per project.
    projects: HashMap<String, ProjectSync>,
}

struct ProjectSync {
    /// Broadcast sender for this project.
    tx: broadcast::Sender<Vec<u8>>,
    /// Active session IDs.
    sessions: Vec<Uuid>,
}

impl SyncState {
    /// Create a new sync state.
    pub fn new() -> Self {
        Self {
            projects: HashMap::new(),
        }
    }

    /// Add a session to a project.
    ///
    /// Returns a receiver for broadcast messages.
    pub fn add_session(&mut self, project_id: &str, session_id: Uuid) -> broadcast::Receiver<Vec<u8>> {
        let project = self.projects.entry(project_id.to_string()).or_insert_with(|| {
            let (tx, _) = broadcast::channel(256);
            ProjectSync {
                tx,
                sessions: Vec::new(),
            }
        });

        project.sessions.push(session_id);
        project.tx.subscribe()
    }

    /// Remove a session from a project.
    pub fn remove_session(&mut self, project_id: &str, session_id: Uuid) {
        if let Some(project) = self.projects.get_mut(project_id) {
            project.sessions.retain(|id| *id != session_id);

            // Clean up empty projects
            if project.sessions.is_empty() {
                self.projects.remove(project_id);
            }
        }
    }

    /// Get the broadcast sender for a project.
    pub fn get_broadcast(&self, project_id: &str) -> Option<&broadcast::Sender<Vec<u8>>> {
        self.projects.get(project_id).map(|p| &p.tx)
    }

    /// Get the number of active sessions for a project.
    pub fn session_count(&self, project_id: &str) -> usize {
        self.projects
            .get(project_id)
            .map(|p| p.sessions.len())
            .unwrap_or(0)
    }
}

impl Default for SyncState {
    fn default() -> Self {
        Self::new()
    }
}
