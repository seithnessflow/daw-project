// SPDX-License-Identifier: GPL-3.0-or-later
//! AUDIT-5 F1: opt-in shared token on the server.
//!
//! No DAW_SERVER_TOKEN -> open (dev default, unchanged). With it set, the
//! WS handshake requires an `auth:<token>` first message before the doc.

use futures::{SinkExt, StreamExt};
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const TOKEN: &str = "test-secret-token-123";

struct ServerGuard(Child);
impl Drop for ServerGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn spawn(port: u16, dir: &std::path::Path, token: Option<&str>) -> ServerGuard {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_daw-server"));
    cmd.current_dir(dir)
        .env("DAW_SERVER_PORT", port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(t) = token {
        cmd.env("DAW_SERVER_TOKEN", t);
    }
    ServerGuard(cmd.spawn().expect("spawn server"))
}

async fn wait_ready(port: u16) {
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("server not ready on {}", port);
}

fn tmpdir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("daw-auth-test-{}-{}", tag, std::process::id()));
    let _ = std::fs::create_dir_all(d.join("projects"));
    d
}

/// Rétrocompat: no token configured -> the initial doc arrives directly.
#[tokio::test]
async fn no_token_configured_is_open() {
    let port = 3911;
    let dir = tmpdir("open");
    let _g = spawn(port, &dir, None);
    wait_ready(port).await;

    let (mut ws, _) = connect_async(format!("ws://127.0.0.1:{}/ws/default", port))
        .await
        .expect("connect");
    let got = tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .expect("timeout")
        .expect("stream ended")
        .expect("ws error");
    assert!(
        matches!(got, Message::Binary(_)),
        "expected initial doc without auth, got {:?}",
        got
    );
}

/// Token required: missing and wrong are refused (no doc), good is accepted.
#[tokio::test]
async fn token_required_refuses_bad_accepts_good() {
    let port = 3912;
    let dir = tmpdir("auth");
    let _g = spawn(port, &dir, Some(TOKEN));
    wait_ready(port).await;

    let url = format!("ws://127.0.0.1:{}/ws/default", port);

    // 1) No auth message at all -> server must never send the doc.
    {
        let (mut ws, _) = connect_async(&url).await.expect("connect");
        let r = tokio::time::timeout(Duration::from_secs(7), ws.next()).await;
        if let Ok(Some(Ok(Message::Binary(_)))) = r {
            panic!("server sent the doc without authentication");
        }
    }
    // 2) Wrong token -> refused.
    {
        let (mut ws, _) = connect_async(&url).await.expect("connect");
        ws.send(Message::Text("auth:wrong-token".into()))
            .await
            .expect("send");
        let r = tokio::time::timeout(Duration::from_secs(7), ws.next()).await;
        if let Ok(Some(Ok(Message::Binary(_)))) = r {
            panic!("server sent the doc with a wrong token");
        }
    }
    // 3) Good token -> the doc arrives.
    {
        let (mut ws, _) = connect_async(&url).await.expect("connect");
        ws.send(Message::Text(format!("auth:{}", TOKEN)))
            .await
            .expect("send");
        let got = tokio::time::timeout(Duration::from_secs(7), ws.next())
            .await
            .expect("timeout")
            .expect("stream ended")
            .expect("ws error");
        assert!(
            matches!(got, Message::Binary(_)),
            "expected the doc after a good token, got {:?}",
            got
        );
    }
}
