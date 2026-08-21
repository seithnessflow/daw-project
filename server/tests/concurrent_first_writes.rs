// SPDX-License-Identifier: GPL-3.0-or-later
//! Two SIMULTANEOUS first connections on a fresh project: the default
//! document must be created exactly once, and a change written immediately
//! by each client must both survive.
//!
//! Guards against the store races found by the persist_before_broadcast
//! test: double default-doc creation (late save clobbers) and concurrent
//! load-modify-write in apply_change.

use automerge::{transaction::Transactable, AutoCommit, ReadDoc, ROOT};
use futures::{SinkExt, StreamExt};
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

// Distinct from persist_before_broadcast.rs: cargo runs test binaries in
// parallel, each spawns its own server
const PORT: u16 = 3908;

// Kills the spawned server even if the test panics: a leaked server keeps
// the port and poisons every later run
struct ServerGuard(Child);

impl ServerGuard {
    fn kill_now(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

impl Drop for ServerGuard {
    fn drop(&mut self) {
        self.kill_now();
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

async fn wait_ready() {
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("127.0.0.1", PORT)).await.is_ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("server did not become ready on port {}", PORT);
}

async fn connect(project: &str) -> Ws {
    let (ws, _) = connect_async(format!("ws://127.0.0.1:{}/ws/{}", PORT, project))
        .await
        .expect("ws connect");
    ws
}

async fn recv_binary(ws: &mut Ws) -> Vec<u8> {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(10), ws.next())
            .await
            .expect("timeout waiting for binary message")
            .expect("stream ended")
            .expect("ws error");
        if let Message::Binary(data) = msg {
            return data;
        }
    }
}

fn gain_of(doc: &AutoCommit, index: usize) -> f64 {
    let (_, tracks_id) = doc.get(ROOT, "tracks").unwrap().expect("tracks");
    let (_, track_id) = doc.get(&tracks_id, index).unwrap().expect("track");
    match doc.get(&track_id, "gain").unwrap().expect("gain") {
        (automerge::Value::Scalar(s), _) => match s.as_ref() {
            automerge::ScalarValue::F64(f) => *f,
            other => panic!("gain is not f64: {:?}", other),
        },
        other => panic!("gain is not scalar: {:?}", other),
    }
}

// Build a change setting tracks[index].gain on the doc the client received
fn make_gain_change(doc_bytes: &[u8], index: usize, gain: f64) -> Vec<u8> {
    let mut doc = AutoCommit::load(doc_bytes).unwrap();
    let (_, tracks_id) = doc.get(ROOT, "tracks").unwrap().expect("tracks");
    let (_, track_id) = doc.get(&tracks_id, index).unwrap().expect("track");
    doc.put(&track_id, "gain", gain).unwrap();
    doc.get_last_local_change()
        .expect("local change")
        .raw_bytes()
        .to_vec()
}

#[tokio::test]
async fn simultaneous_first_writes_both_survive() {
    let dir = std::env::temp_dir().join(format!("daw-firstwrite-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let mut server = spawn_server(&dir);
    wait_ready().await;

    // The window is timing-dependent: several attempts, each on a FRESH
    // project. Every attempt must keep both writes.
    for attempt in 0..10 {
        let project = format!("race-{}", attempt);

        // Simultaneous first connections
        let (mut a, mut b) = tokio::join!(connect(&project), connect(&project));
        let (doc_a, doc_b) = tokio::join!(recv_binary(&mut a), recv_binary(&mut b));

        // Each writes a change immediately, on different tracks
        let change_a = make_gain_change(&doc_a, 0, 0.111);
        let change_b = make_gain_change(&doc_b, 1, 0.222);
        let (ra, rb) = tokio::join!(
            a.send(Message::Binary(change_a)),
            b.send(Message::Binary(change_b))
        );
        ra.unwrap();
        rb.unwrap();

        // Let the server process both, then read back with a fresh client
        tokio::time::sleep(Duration::from_millis(300)).await;
        let mut c = connect(&project).await;
        let final_bytes = recv_binary(&mut c).await;
        let final_doc = AutoCommit::load(&final_bytes).unwrap();

        let g0 = gain_of(&final_doc, 0);
        let g1 = gain_of(&final_doc, 1);
        assert!(
            (g0 - 0.111).abs() < 1e-9 && (g1 - 0.222).abs() < 1e-9,
            "attempt {}: a first write DISAPPEARED (track0={}, track1={})",
            attempt,
            g0,
            g1
        );
    }

    server.kill_now();
    let _ = std::fs::remove_dir_all(&dir);
}
