// SPDX-License-Identifier: GPL-3.0-or-later
//! DAW Sync Server
//!
//! Provides Automerge CRDT synchronization between browser clients and the local engine.

use anyhow::Result;
use axum::{
    routing::get,
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use axum::http::Method;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use daw_server::{api, document, AppState, SyncState};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "daw_server=debug,tower_http=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // AUDIT-5 F1: opt-in shared token. Set DAW_SERVER_TOKEN to require auth
    // (tunnel/exposed mode); unset (dev default) keeps the current no-auth
    // behaviour. An empty value is treated as unset.
    // AUDIT-5 F1 robustness: trim - a token set via `set VAR=x && cmd` in
    // cmd.exe keeps the space before && ("x "), which broke auth silently.
    let auth_token = std::env::var("DAW_SERVER_TOKEN")
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    if auth_token.is_some() {
        tracing::info!("Auth: shared token REQUIRED (DAW_SERVER_TOKEN set)");
    }

    // Initialize state
    let state = Arc::new(AppState {
        store: Box::new(document::FileStore::new("./projects")?),
        sync_state: RwLock::new(SyncState::new()),
        store_lock: tokio::sync::Mutex::new(()),
        auth_token,
    });

    // CORS layer for browser access (audit C2: was allow_origin(Any) -
    // any website could fetch/PUT assets on localhost). Tightened to the
    // dev web origins; the ws + asset handlers enforce the same Origin
    // allowlist in code (CORS does not gate WebSocket).
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:5173".parse().unwrap(),
            "http://127.0.0.1:5173".parse().unwrap(),
        ])
        .allow_methods([Method::GET, Method::PUT])
        .allow_headers(Any)
        // Required for Chrome Local Network Access
        .allow_private_network(true);

    // Build router
    let app = Router::new()
        .route("/health", get(|| async { "OK" }))
        .route("/ws/:project_id", get(api::websocket::ws_handler))
        // 2.3b: content-addressed asset store (engine<->server HTTP side).
        // 512 MB cap: a 10-minute 48k stereo 24-bit wav is ~170 MB.
        .route(
            "/assets/:hash",
            get(api::assets::get_asset)
                .put(api::assets::put_asset)
                .layer(axum::extract::DefaultBodyLimit::max(512 * 1024 * 1024)),
        )
        .layer(cors)
        .with_state(state);

    // Start server
    // Port override for integration tests (default 3000)
    let port: u16 = std::env::var("DAW_SERVER_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    // 1bis (two machines): bind address opt-in via DAW_SERVER_BIND
    // (e.g. 0.0.0.0 for the LAN smoke). DEFAULT STAYS LOOPBACK: on
    // 0.0.0.0 any LAN process is a "native client" (no Origin header,
    // exempt by design) with full project access - the C2-remote debt
    // (shared secret for real remote peers) becomes LIVE the day this
    // is exposed beyond a trusted network. Recorded in SECURITY.md.
    let bind_ip: std::net::IpAddr = std::env::var("DAW_SERVER_BIND")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| std::net::IpAddr::from([127, 0, 0, 1]));
    let addr = SocketAddr::from((bind_ip, port));
    tracing::info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
