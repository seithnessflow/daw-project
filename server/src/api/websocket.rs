// SPDX-License-Identifier: GPL-3.0-or-later
//! WebSocket handler for Automerge sync.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::HeaderMap,
    response::{IntoResponse, Response},
};

use super::origin::origin_allowed;

/// Cap on a single incoming WS frame (audit H2): an unbounded Automerge
/// blob parsed under the store lock is a DoS. 8 MB dwarfs any legitimate
/// single change (a fat drag coalesces to a few KB) while refusing the
/// pathological.
const MAX_WS_MESSAGE: usize = 8 * 1024 * 1024;
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;

use crate::document::SEED_DOC;

/// A project id is a FILE STEM: it becomes `<id>.am` under ./projects.
/// Validate BEFORE any FS join (audit C1: `..\..\evil` on Windows was an
/// arbitrary .am write/read - backslash is a separator the URL layer
/// never decodes away). Defense in depth: FileStore re-checks too.
pub fn valid_project_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// WebSocket upgrade handler.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(project_id): Path<String>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    // Audit C2: a drive-by website (disallowed Origin) is refused before
    // the upgrade; native clients (no Origin) pass, like the engine.
    if !origin_allowed(&headers) {
        tracing::warn!("Rejected ws: disallowed origin");
        return (axum::http::StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    if !valid_project_id(&project_id) {
        tracing::warn!("Rejected invalid project id: {:?}", project_id);
        return (axum::http::StatusCode::BAD_REQUEST, "invalid project id").into_response();
    }
    tracing::info!("WebSocket connection for project: {}", project_id);
    // Audit H2: bound a single frame (unbounded blob under the store lock
    // is a DoS surface).
    ws.max_message_size(MAX_WS_MESSAGE)
        .on_upgrade(move |socket| handle_socket(socket, project_id, state))
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

    // Load initial document, or create default with 2 tracks.
    // Under store_lock: only ONE task can create the default document;
    // a simultaneous second connection waits, then loads what the first
    // created (the late duplicate save used to clobber applied changes).
    let _create_guard = state.store_lock.lock().await;
    let doc_data = match state.store.load(&project_id).await {
        Ok(Some(data)) => data,
        Ok(None) => {
            // New project: persist the SEED (A4-3). A4-1c: a failed save
            // CLOSES the connection - continuing with a never-persisted
            // document meant every later change was applied to a doc the
            // disk did not have, then lost on the next load.
            let data = SEED_DOC.to_vec();
            if let Err(e) = state.store.save(&project_id, &data).await {
                tracing::error!("Failed to save seed document, closing: {}", e);
                return;
            }
            data
        }
        Err(e) => {
            tracing::error!("Failed to load document: {}", e);
            return;
        }
    };

    drop(_create_guard);

    if sender.send(Message::Binary(doc_data)).await.is_err() {
        tracing::warn!("Failed to send initial document");
        return;
    }

    // Spawn task to forward broadcasts to this client.
    // A4-4: interleaved with a 15 s application heartbeat (text "hb") -
    // JS cannot see WS pings, so the tab's zombie-socket watchdog needs
    // traffic it can observe. A failed heartbeat send also unmasks a
    // dead client here, closing the session.
    let session_id_clone = session_id;
    let mut send_task = tokio::spawn(async move {
        let mut msg_count = 0u64;
        let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(15));
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        heartbeat.tick().await; // first tick fires immediately - consume it
        loop {
            tokio::select! {
                received = rx.recv() => match received {
                    Ok(msg) => {
                        // S8b: internally-tagged signaling goes out as TEXT
                        // (old clients ignore text; the doc path never sees it)
                        if msg.len() >= 2 && msg[0] == 0xFF && msg[1] == b'S' {
                            let text = String::from_utf8_lossy(&msg[2..]).into_owned();
                            if sender.send(Message::Text(format!("signal:{}", text))).await.is_err() {
                                break;
                            }
                            continue;
                        }
                        let msg_len = msg.len();
                        match sender.send(Message::Binary(msg)).await {
                            Ok(_) => {
                                msg_count += 1;
                                tracing::info!("Session {}: Forwarded {} bytes to client (total: {})", session_id_clone, msg_len, msg_count);
                            }
                            Err(e) => {
                                tracing::info!("Session {}: WebSocket send failed: {}, closing", session_id_clone, e);
                                break;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        // Receiver fell behind, skip missed messages and continue
                        tracing::warn!("Session {}: Broadcast receiver lagged by {} messages", session_id_clone, n);
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        // Channel closed (project removed)
                        tracing::info!("Session {}: Broadcast channel closed (project removed?)", session_id_clone);
                        break;
                    }
                },
                _ = heartbeat.tick() => {
                    if let Err(e) = sender.send(Message::Text("hb".to_string())).await {
                        tracing::info!("Session {}: heartbeat send failed: {}, closing", session_id_clone, e);
                        break;
                    }
                }
            }
        }
        tracing::info!("Session {}: send_task exiting after {} messages", session_id_clone, msg_count);
    });

    // Handle incoming messages
    let state_clone = state.clone();
    let project_id_clone = project_id.clone();
    let session_id_recv = session_id;
    let mut recv_task = tokio::spawn(async move {
        loop {
            match receiver.next().await {
                Some(Ok(msg)) => {
                    match msg {
                        Message::Binary(data) => {
                            tracing::info!("Session {}: Received binary message: {} bytes", session_id_recv, data.len());

                            // Persist FIRST: a change may only be broadcast
                            // once it is durable. Broadcasting before
                            // persisting used to lose changes on a crash in
                            // between, while peers had already applied them.
                            {
                                // store_lock: apply_change is an unlocked
                                // load-modify-write; concurrent applies from
                                // two sessions can lose one change
                                let _guard = state_clone.store_lock.lock().await;
                                if let Err(e) = state_clone.store.apply_change(&project_id_clone, &data).await {
                                    tracing::error!("Session {}: Failed to persist change, NOT broadcasting: {}", session_id_recv, e);
                                    continue;
                                }
                            }

                            // Broadcast to other clients
                            let sync_state = state_clone.sync_state.read().await;
                            if let Some(tx) = sync_state.get_broadcast(&project_id_clone) {
                                // Broadcast to all clients (including sender for consistency)
                                let receiver_count = tx.receiver_count();
                                tracing::info!("Session {}: Broadcasting to {} receivers", session_id_recv, receiver_count);
                                match tx.send(data.clone()) {
                                    Ok(n) => tracing::info!("Session {}: Broadcast sent to {} receivers", session_id_recv, n),
                                    Err(e) => tracing::error!("Session {}: Broadcast failed: {}", session_id_recv, e),
                                }
                            } else {
                                tracing::warn!("Session {}: No broadcast channel for project {}", session_id_recv, project_id_clone);
                            }
                            drop(sync_state);
                        }
                        Message::Close(frame) => {
                            tracing::info!("Session {}: Received Close frame: {:?}", session_id_recv, frame);
                            break;
                        }
                        Message::Ping(_) => {}
                        Message::Pong(_) => {}
                        Message::Text(t) => {
                            // S8b: jam signaling relay. "signal:{json}" is
                            // relayed VERBATIM to every peer of the project
                            // (sender filters its own via the embedded id).
                            // The server never parses the payload - pure
                            // signaling, ADR-019 kept literally.
                            if let Some(payload) = t.strip_prefix("signal:") {
                                let sync_state = state_clone.sync_state.read().await;
                                if let Some(tx) = sync_state.get_broadcast(&project_id_clone) {
                                    // Internal tag: broadcast carries Vec<u8>;
                                    // 0xFF 'S' cannot collide with an Automerge
                                    // frame (magic 0x85 0x6F 0x4A 0x83).
                                    let mut framed = vec![0xFFu8, b'S'];
                                    framed.extend_from_slice(payload.as_bytes());
                                    let _ = tx.send(framed);
                                }
                            } else {
                                tracing::warn!("Session {}: Received unexpected text message: {}", session_id_recv, t);
                            }
                        }
                    }
                }
                Some(Err(e)) => {
                    tracing::error!("Session {}: WebSocket error: {}", session_id_recv, e);
                    break;
                }
                None => {
                    tracing::info!("Session {}: WebSocket stream ended (client disconnected)", session_id_recv);
                    break;
                }
            }
        }
        tracing::info!("Session {}: recv_task exiting", session_id_recv);
    });

    // Wait for either task to finish
    let exit_reason = tokio::select! {
        result = &mut send_task => {
            recv_task.abort();
            format!("send_task finished: {:?}", result)
        }
        result = &mut recv_task => {
            send_task.abort();
            format!("recv_task finished: {:?}", result)
        }
    };

    tracing::info!("Session {}: {} ", session_id, exit_reason);

    // Cleanup session
    {
        let mut sync_state = state.sync_state.write().await;
        sync_state.remove_session(&project_id, session_id);
    }

    tracing::info!("Session {} disconnected and cleaned up", session_id);
}
