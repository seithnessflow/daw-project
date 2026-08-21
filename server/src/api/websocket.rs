//! WebSocket handler for Automerge sync.

use automerge::{transaction::Transactable, AutoCommit, ObjType, ROOT};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    response::Response,
};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;

/// Create a default document with 2 test tracks.
fn create_default_document() -> AutoCommit {
    let mut doc = AutoCommit::new();

    // Set schema version
    doc.put(ROOT, "schemaVersion", 1i64).unwrap();
    doc.put(ROOT, "sampleRate", 48000i64).unwrap();

    // Create tracks array
    let tracks = doc.put_object(ROOT, "tracks", ObjType::List).unwrap();

    // Track 1
    let track1 = doc.insert_object(&tracks, 0, ObjType::Map).unwrap();
    doc.put(&track1, "id", "track-1").unwrap();
    doc.put(&track1, "name", "Track 1").unwrap();
    doc.put(&track1, "gain", 1.0f64).unwrap();
    doc.put_object(&track1, "clips", ObjType::List).unwrap();
    doc.put_object(&track1, "chain", ObjType::List).unwrap();

    // Track 2
    let track2 = doc.insert_object(&tracks, 1, ObjType::Map).unwrap();
    doc.put(&track2, "id", "track-2").unwrap();
    doc.put(&track2, "name", "Track 2").unwrap();
    doc.put(&track2, "gain", 0.75f64).unwrap();
    doc.put_object(&track2, "clips", ObjType::List).unwrap();
    doc.put_object(&track2, "chain", ObjType::List).unwrap();

    doc
}

/// WebSocket upgrade handler.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(project_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Response {
    tracing::info!("WebSocket connection for project: {}", project_id);
    ws.on_upgrade(move |socket| handle_socket(socket, project_id, state))
}

/// Handle an individual WebSocket connection.
async fn handle_socket(socket: WebSocket, project_id: String, state: Arc<AppState>) {
    let session_id = Uuid::new_v4();
    tracing::info!("New session {} for project {}", session_id, project_id);

    let (mut sender, mut receiver) = socket.split();

    // Register session
    let mut rx = {
        let mut sync_state = state.sync_state.write().await;
        sync_state.add_session(&project_id, session_id)
    };

    // Load initial document, or create default with 2 tracks
    let doc_data = match state.store.load(&project_id).await {
        Ok(Some(data)) => data,
        Ok(None) => {
            // Create default document with 2 tracks
            let mut doc = create_default_document();
            let data = doc.save();
            // Persist the new document
            if let Err(e) = state.store.save(&project_id, &data).await {
                tracing::error!("Failed to save default document: {}", e);
            }
            data
        }
        Err(e) => {
            tracing::error!("Failed to load document: {}", e);
            return;
        }
    };

    if sender.send(Message::Binary(doc_data)).await.is_err() {
        tracing::warn!("Failed to send initial document");
        return;
    }

    // Spawn task to forward broadcasts to this client
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Binary(msg)).await.is_err() {
                break;
            }
        }
    });

    // Handle incoming messages
    let state_clone = state.clone();
    let project_id_clone = project_id.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Binary(data) => {
                    // Apply change and broadcast to other clients
                    let sync_state = state_clone.sync_state.read().await;
                    if let Some(tx) = sync_state.get_broadcast(&project_id_clone) {
                        // Broadcast to all clients (including sender for consistency)
                        let _ = tx.send(data.clone());
                    }
                    drop(sync_state);

                    // Persist change
                    if let Err(e) = state_clone.store.apply_change(&project_id_clone, &data).await {
                        tracing::error!("Failed to persist change: {}", e);
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Wait for either task to finish
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    // Cleanup session
    {
        let mut sync_state = state.sync_state.write().await;
        sync_state.remove_session(&project_id, session_id);
    }

    tracing::info!("Session {} disconnected", session_id);
}
