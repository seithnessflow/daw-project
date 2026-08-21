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

    // Initialize state
    let state = Arc::new(AppState {
        store: Box::new(document::FileStore::new("./projects")?),
        sync_state: RwLock::new(SyncState::new()),
    });

    // CORS layer for browser access
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
        // Required for Chrome Local Network Access
        .allow_private_network(true);

    // Build router
    let app = Router::new()
        .route("/health", get(|| async { "OK" }))
        .route("/ws/:project_id", get(api::websocket::ws_handler))
        .layer(cors)
        .with_state(state);

    // Start server
    // Port override for integration tests (default 3000)
    let port: u16 = std::env::var("DAW_SERVER_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
