// SPDX-License-Identifier: GPL-3.0-or-later
//! Origin allowlist (audit C2) - mirrors the engine's proven model
//! (websocket_server.cpp): a browser ALWAYS sends an Origin header, so a
//! present-but-disallowed Origin is rejected outright, blocking drive-by
//! websites from reaching localhost:3000. A native/non-browser client
//! sends no Origin and is exempt (a real cross-machine peer will need a
//! shared secret - consigned as a future collaborative item, SECURITY.md
//! C2 remote half).

use axum::http::HeaderMap;

/// Local-first trust rule: an Origin is allowed iff its HOST is
/// localhost / 127.0.0.1 / [::1] (any scheme, any port). This covers the
/// dev web app (:5173), same-origin pages, and the native engine's ws
/// client (ixwebsocket defaults its Origin to the target host) - while a
/// cross-machine drive-by website (`https://evil.com`) is refused,
/// because a browser sets Origin truthfully and can never forge a
/// localhost host. Robust to any local client's exact port/scheme,
/// unlike a fixed string allowlist.
///
/// A real remote peer will be a native client (no Origin, exempt today);
/// authenticating remote peers is the future collaborative half of C2
/// (SECURITY.md), not this local guard.
fn is_local_origin(origin: &str) -> bool {
    // strip scheme://
    let after = origin.split_once("://").map(|(_, r)| r).unwrap_or(origin);
    // host is up to the first ':' (port) or '/'
    let host = after.split([':', '/']).next().unwrap_or("");
    matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1")
}

/// True if the request may proceed: no Origin (native client) or a
/// local-host Origin.
pub fn origin_allowed(headers: &HeaderMap) -> bool {
    match headers.get(axum::http::header::ORIGIN) {
        None => true, // native client, no browser Origin
        Some(value) => value.to_str().map(is_local_origin).unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use super::is_local_origin;

    #[test]
    fn accepts_local_origins() {
        for o in ["http://localhost:5173", "http://127.0.0.1:5173",
                  "http://localhost:3000", "http://localhost", "ws://127.0.0.1:9000"] {
            assert!(is_local_origin(o), "should allow {o}");
        }
    }

    #[test]
    fn refuses_drive_by_sites() {
        for o in ["https://evil.com", "http://attacker.example:5173",
                  "https://localhost.evil.com", "http://notlocalhost"] {
            assert!(!is_local_origin(o), "should refuse {o}");
        }
    }
}
