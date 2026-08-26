// SPDX-License-Identifier: GPL-3.0-or-later
//! Content-addressed asset store (2.3b) - the HTTP side of the
//! engine<->server triangle ("nothing real-time crosses the server").
//!
//! GET  /assets/:hash  -> the stored bytes (any historical hex key: the
//!                        16-char FNV names from before 2.3a stay readable)
//! PUT  /assets/:hash  -> stores AFTER VERIFYING sha256(body) == hash.
//!                        A content-addressed store that does not verify
//!                        its content is a lie; uploads therefore accept
//!                        ONLY 64-char SHA-256 keys (legacy keys are
//!                        read-only history).
//!
//! Storage: ./assets/<hash>.wav next to ./projects (same CWD convention,
//! same atomic temp+rename write mold as FileStore).

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use sha2::{Digest, Sha256};
use std::sync::Arc;

use super::origin::origin_allowed;
use crate::AppState;

const ASSETS_DIR: &str = "./assets";

/// AUDIT-5 F1: when a token is configured, /assets requires
/// `Authorization: Bearer <token>`. No token configured = open (unchanged).
fn bearer_ok(headers: &HeaderMap, expected: &Option<String>) -> bool {
    match expected {
        None => true,
        Some(tok) => headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|got| crate::constant_time_eq(got.trim().as_bytes(), tok.as_bytes()))
            .unwrap_or(false),
    }
}

/// The hash is a PATH COMPONENT: hex only, bounded length, or nothing.
fn asset_file(hash: &str) -> Option<std::path::PathBuf> {
    if hash.is_empty() || hash.len() > 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(std::path::Path::new(ASSETS_DIR).join(format!("{hash}.wav")))
}

pub async fn get_asset(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(hash): Path<String>,
) -> impl IntoResponse {
    if !origin_allowed(&headers) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    if !bearer_ok(&headers, &state.auth_token) {
        return (StatusCode::UNAUTHORIZED, "missing or bad token").into_response();
    }
    let Some(path) = asset_file(&hash) else {
        return (StatusCode::BAD_REQUEST, "hash must be hex (<= 64 chars)").into_response();
    };
    match tokio::fs::read(&path).await {
        Ok(bytes) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/octet-stream")],
            bytes,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "unknown asset").into_response(),
    }
}

pub async fn put_asset(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(hash): Path<String>,
    body: Bytes,
) -> impl IntoResponse {
    if !origin_allowed(&headers) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    if !bearer_ok(&headers, &state.auth_token) {
        return (StatusCode::UNAUTHORIZED, "missing or bad token").into_response();
    }
    let Some(path) = asset_file(&hash) else {
        return (StatusCode::BAD_REQUEST, "hash must be hex (<= 64 chars)").into_response();
    };
    if hash.len() != 64 {
        return (
            StatusCode::BAD_REQUEST,
            "uploads require a 64-char sha256 key (legacy keys are read-only)",
        )
            .into_response();
    }
    let actual = format!("{:x}", Sha256::digest(&body));
    if actual != hash.to_ascii_lowercase() {
        return (
            StatusCode::BAD_REQUEST,
            "content does not match its hash - refused",
        )
            .into_response();
    }

    if let Err(e) = tokio::fs::create_dir_all(ASSETS_DIR).await {
        tracing::error!("asset dir: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "store unavailable").into_response();
    }
    // Atomic write: temp + rename, the FileStore mold
    let tmp = path.with_extension("tmp");
    if let Err(e) = tokio::fs::write(&tmp, &body).await {
        tracing::error!("asset write: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    if let Err(e) = tokio::fs::rename(&tmp, &path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        tracing::error!("asset rename: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    tracing::info!("asset stored: {} ({} bytes)", hash, body.len());
    (StatusCode::CREATED, "stored").into_response()
}
