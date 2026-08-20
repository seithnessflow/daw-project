//! WebSocket handler for Automerge sync.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    response::Response,
};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::AppState;

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

    // Load initial document
    if let Ok(Some(doc_data)) = state.store.load(&project_id).await {
        if sender.send(Message::Binary(doc_data)).await.is_err() {
            tracing::warn!("Failed to send initial document");
            return;
        }
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
