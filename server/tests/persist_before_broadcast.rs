//! A change a peer has SEEN broadcast must survive a brutal server kill.
//!
//! Guards the persist-before-broadcast ordering in the ws recv path: the
//! server used to broadcast first and persist afterwards, so a crash in
//! between lost a change that peers had already applied.

use automerge::{transaction::Transactable, AutoCommit, ReadDoc, ROOT};
use futures::{SinkExt, StreamExt};
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

const PORT: u16 = 3907;

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

fn track0_gain(doc_bytes: &[u8]) -> f64 {
    let doc = AutoCommit::load(doc_bytes).expect("load doc");
    let (_, tracks_id) = doc.get(ROOT, "tracks").unwrap().expect("tracks");
    let (_, track0_id) = doc.get(&tracks_id, 0).unwrap().expect("track 0");
    match doc.get(&track0_id, "gain").unwrap().expect("gain") {
        (automerge::Value::Scalar(s), _) => match s.as_ref() {
            automerge::ScalarValue::F64(f) => *f,
            other => panic!("gain is not f64: {:?}", other),
        },
        other => panic!("gain is not scalar: {:?}", other),
    }
}

#[tokio::test]
async fn change_seen_by_peer_survives_brutal_kill() {
    let dir = std::env::temp_dir().join(format!("daw-persist-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let mut server = spawn_server(&dir);
    wait_ready().await;

    let project = "persist-test";
    // Serialized on purpose: two SIMULTANEOUS first connections can both
    // see an empty store and the late default-doc save clobbers the file
    // (separate known defect, tracked in TODO.md). This test targets the
    // persist-before-broadcast ordering only.
    let mut a = connect(project).await;
    let doc_bytes = recv_binary(&mut a).await;
    let mut b = connect(project).await;
    let _ = recv_binary(&mut b).await;

    // A builds a real change: tracks[0].gain -> 0.123
    let mut doc = AutoCommit::load(&doc_bytes).unwrap();
    let (_, tracks_id) = doc.get(ROOT, "tracks").unwrap().expect("tracks");
    let (_, track0_id) = doc.get(&tracks_id, 0).unwrap().expect("track 0");
    doc.put(&track0_id, "gain", 0.123f64).unwrap();
    let change = doc
        .get_last_local_change()
        .expect("local change")
        .raw_bytes()
        .to_vec();

    a.send(Message::Binary(change)).await.unwrap();

    // THE invariant under test: the instant a peer SEES the broadcast,
    // the change must already be durable. Kill the server brutally now.
    let _echoed = recv_binary(&mut b).await;
    server.kill_now();

    // Restart on the same store: a fresh client must see the change
    let mut server2 = spawn_server(&dir);
    wait_ready().await;
    let mut c = connect(project).await;
    let doc2_bytes = recv_binary(&mut c).await;
    server2.kill_now();

    let gain = track0_gain(&doc2_bytes);
    assert!(
        (gain - 0.123).abs() < 1e-9,
        "broadcast-acknowledged change LOST after brutal kill (gain={})",
        gain
    );

    let _ = std::fs::remove_dir_all(&dir);
}
