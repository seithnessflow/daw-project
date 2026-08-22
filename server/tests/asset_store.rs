// SPDX-License-Identifier: GPL-3.0-or-later
//! Content-addressed asset store (2.3b): the server VERIFIES what it
//! stores. Good-hash PUT round-trips byte-identical; a body that does not
//! match its claimed hash is REFUSED; unknown assets are 404; legacy
//! (16-char FNV) keys are read-only history - uploads demand sha256.

use sha2::{Digest, Sha256};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

// Distinct port: cargo runs test binaries in parallel
const PORT: u16 = 3909;

struct ServerGuard(Child);

impl Drop for ServerGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn spawn_server(dir: &std::path::Path) -> ServerGuard {
    ServerGuard(
        Command::new(env!("CARGO_BIN_EXE_daw-server"))
            .current_dir(dir)
            .env("DAW_SERVER_PORT", PORT.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn server"),
    )
}

fn wait_ready() {
    for _ in 0..100 {
        if std::net::TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("server did not become ready on port {PORT}");
}

fn url(hash: &str) -> String {
    format!("http://127.0.0.1:{PORT}/assets/{hash}")
}

fn status_of(err: ureq::Error) -> u16 {
    match err {
        ureq::Error::Status(code, _) => code,
        other => panic!("transport error instead of HTTP status: {other}"),
    }
}

#[test]
fn asset_store_verifies_its_content() {
    let dir = std::env::temp_dir().join(format!("daw-asset-store-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("test dir");
    let _server = spawn_server(&dir);
    wait_ready();

    let body: Vec<u8> = (0..100_000u32).map(|i| (i * 31 % 251) as u8).collect();
    let hash = format!("{:x}", Sha256::digest(&body));

    // Unknown asset -> 404
    let missing = ureq::get(&url(&hash)).call();
    assert_eq!(status_of(missing.expect_err("should 404")), 404);

    // Good PUT -> 201, GET round-trips byte-identical
    let put = ureq::put(&url(&hash))
        .send_bytes(&body)
        .expect("good put");
    assert_eq!(put.status(), 201);
    let got = ureq::get(&url(&hash)).call().expect("get");
    let mut round = Vec::new();
    got.into_reader()
        .read_to_end(&mut round)
        .expect("read body");
    assert_eq!(round, body, "stored bytes differ from uploaded bytes");

    // A body that does not match its claimed hash is REFUSED
    let wrong_hash = format!("{:x}", Sha256::digest(b"something else"));
    let lied = ureq::put(&url(&wrong_hash)).send_bytes(&body);
    assert_eq!(status_of(lied.expect_err("must refuse")), 400);
    assert_eq!(
        status_of(ureq::get(&url(&wrong_hash)).call().expect_err("nothing stored")),
        404,
        "a refused upload must leave nothing behind"
    );

    // Legacy 16-char keys: read-only history, uploads demand sha256
    let legacy = ureq::put(&url("0123456789abcdef")).send_bytes(&body);
    assert_eq!(status_of(legacy.expect_err("legacy write refused")), 400);

    // Non-hex key: never a path component
    let traversal = ureq::put(&url("zz..zz")).send_bytes(&body);
    assert_eq!(status_of(traversal.expect_err("non-hex refused")), 400);

    let _ = std::fs::remove_dir_all(&dir);
}
