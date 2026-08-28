# Magic Potion

**Le logiciel s'ecoute lui-meme — tout ce qui sonne se voit.**

A collaborative DAW with three tiers: browser (UI), server (sync), and
native engine (audio). The document belongs to the human; the software
observes continuously, displays continuously, corrects never.

*(Infrastructure rename - repo, binaries, packages - is deferred churn:
see TODO backlog. The identity lives here, in the title bar and the
tagline, today.)*

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Browser      │────▶│     Server      │◀────│   Local Engine  │
│   (TypeScript)  │     │     (Rust)      │     │     (C++)       │
│                 │     │                 │     │                 │
│ • UI            │     │ • Automerge     │     │ • Audio output  │
│ • Document      │     │ • WebSocket     │     │ • WAV playback  │
│   (source of    │     │ • Persistence   │     │ • Graph         │
│    truth)       │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
      ▲   browser<->engine: WebSocket (Protobuf, telemetry/transport)  │
      │   engine<->server:  HTTP (content-addressed assets) - triangle │
      └───────────────────────────────────────────────────────────────┘
```

The document is an Automerge CRDT (binary `.am`), synced by the server;
assets are content-addressed by SHA-256 in a verifying store. **The law
(ADR-019): no audio is ever PROCESSED server-side; audio between peers
travels P2P (WebRTC); the server only does signaling (+ optional TURN)
and serves the store.**

**The product invariant (ADR-019): a peer who does NOT have a plugin
installed still hears that plugin's output.** The machine that owns the
plugin renders "stems" (the node's audio, keyed by a hash of all its
inputs) into the content-addressed store; the peer without the plugin
plays the stem in place of the unresolved node, with a 3-state
freshness badge. Proven byte-for-byte across two machines / two
networks, including with commercial plugins.

## What it does today (2026-08-28)

- Collaborative editing of one project from several machines, each
  with its own native engine (CRDT convergence, offline-first, undo by
  inverse operations that never rewinds a peer's work).
- Arrangement: audio and MIDI tracks, clips (move / trim / split /
  fades / rename / duplicate / drag across tracks), user loop, snap
  grid, zoom / minimap / follow; automation lanes (gain / pan / master)
  drawn with the mouse and evaluated bit-exactly by the engine.
- Musical time (schema v2, additive): integer milli-BPM tempo, ticks
  (PPQ 960) beside absolute samples, an integer tempo kernel mirrored
  in TypeScript and C++ and pinned by shared golden vectors.
- Session view (scenes, quantized launch with engine truth), mixer
  console (faders, pan, local mute/solo, ballistic VU meters).
- Out-of-process VST3 hosting: one child process per instance, shared
  memory ring, crash = cold restart (never the engine's death), native
  GUI windows on demand, VST3 folder scan / catalogue, drag & drop.
  Five native effects (utility, EQ3, compressor, drive, delay).
- Plugin state and rendered stems in the store; freshness badges.
- P2P jam streaming (WebRTC, STUN, two NATs crossed for real) and
  Link-style transport sync between machines (session clock + anchors).
- Deterministic offline render (reference hashes asserted on two OSes,
  per-stage `--probe` proof), one-click mixdown export, universal import
  (mp3 / flac / ogg decoded in the browser to canonical WAV at project
  rate), sample preview.
- WASAPI shared or **exclusive** mode (`--exclusive --buffer-size 256`
  = 16 ms measured, 0 underruns under load).

**Not yet** (see TODO.md and docs/audits/AUDIT-6.md): audio recording and
live MIDI input, sends / returns / groups, master device chain,
multi-selection / clipboard, ASIO, project backups. Live state
(criteria, test counts) lives in STATUS.md — this file does not repeat
it.

## Prerequisites

Primary development platform is **Windows 11 native with MSVC** (no
WSL); Linux/GCC is used by CI only. You need Visual Studio Build Tools
2022 (C++ workload + CMake + Ninja), a Rust toolchain (MSVC target),
Node.js 20+ and `protoc`. Setup details: `docs/ADR-015-windows-native-build.md`.
The Linux recipe (pinned automerge-c commit, VST3 SDK tag) is
`.github/workflows/ci.yml`, the authoritative build script.

## Quick Start

On Windows (the primary dev platform), one command starts everything:

```powershell
scripts\daw.ps1        # server + engine + web, browser opens with token set
scripts\daw.ps1 -Stop  # tear the stack down
```

Manual build (Linux path, mirrors `.github/workflows/ci.yml` - the CI file
is the authoritative build recipe, including the pinned automerge-c commit
and VST3 SDK tag):

```bash
# 1. Build automerge-c (pinned) and clone the VST3 SDK (pinned) into
#    third_party/ - see the "Clone and build automerge-c" and
#    "Clone VST3 SDK" steps of ci.yml for the exact commands.

# 2. Build engine
cd engine
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)

# 3. Generate a playable fixture (10s tone document + hashed asset)
ASSET_HASH=$(./build/create_test_doc test-assets/test.am test-assets 10 \
  | grep 'Asset hash' | awk '{print $3}')
cp test-assets/test_tone.wav "test-assets/${ASSET_HASH}.wav"

# 4. Test playback and offline render
./build/daw_engine --doc test-assets/test.am --play --assets test-assets
./build/daw_engine --doc test-assets/test.am --render out.wav --assets test-assets
```

On Windows the engine builds with MSVC in `engine\build-msvc`
(`..\rebuild_msvc.bat`); see STATUS.md for the local commands.

## Acceptance Criteria

Six criteria (deterministic render, CLI test without browser,
two-machine convergence, Chrome Local Network Access from a public
HTTPS origin, WASAPI without underruns, the stems invariant). Their
current status, proofs and living procedures are owned by `STATUS.md`;
reference hashes and measurement history by `docs/DECISIONS.md`.

```bash
# Deterministic render: render twice, compare (the two reference hashes,
# absolute 56729beb61993cd7 and musical c1233ae9d6ab9e83, are asserted
# inside daw_engine_test AND ci.yml)
./engine/build/daw_engine --doc engine/test-assets/test.am --render /tmp/out1.wav --assets engine/test-assets
./engine/build/daw_engine --doc engine/test-assets/test.am --render /tmp/out2.wav --assets engine/test-assets
sha256sum /tmp/out1.wav /tmp/out2.wav

# CLI integration tests, no browser needed
./engine/build/daw_engine_test
```

## Project Structure

```
/engine     C++ audio engine
  /src
    /audio      Audio device (miniaudio/WASAPI), sacred callback, ring buffers
    /graph      Audio graph, native nodes, clip player, tempo kernel, automation
    /host       Out-of-process VST3 host: shared ring, proxy node, bridge, plugin_host.exe
    /document   Automerge wrapper, schema
    /network    Client to the sync server (document + asset fetch)
    /protocol   Protobuf (browser<->engine, engine<->plugin_host)
    /render     Offline render, stems, export job, per-stage probe
    /transport  Play/stop/seek/loop state (lock-free atomics)
    /websocket  Local WebSocket server (auth, telemetry 30 Hz, commands)
    /util       SHA-256, crash handler, path safety
  /tests        gtest-style integration tests (cli_integration_test.cpp)

/server     Rust sync server (axum)
  /src
    /api        WebSocket sync + signal relay, asset store, origin/auth guards
    /document   File store (.am per project, atomic), vendored seed

/web        TypeScript web client (Vite, no framework)
  /src
    /app        Wiring, gestures, rendering, navigation, guards, paradigms
    /document   Automerge wrapper, schema, tempo kernel, geometry, undo, sanitize
    /network    WebSocket clients (server, engine), jam (WebRTC), transport sync
    /proto      Generated protobuf code
    /ui         Tracks, mixer, session, piano-roll, browser, meters, life layer
  /tests/e2e    Playwright specs (real engine spawned on critical paths)

/scripts     Stack launcher (daw.ps1), perf/latency benches, two-machine tools
/docs        Decisions (ADRs), schema, designs, audits/, archive/ — see docs/README.md
/fixtures    Test files (golden tempo vectors, seed documents)
/traces      Visual traces of piloted sessions
/third_party Pinned SDKs (VST3, automerge) — not committed
```

## Engine CLI Reference

```
Usage:
  daw_engine --server <url> --play [--project <id>] [--assets <dir>]
  daw_engine --doc <file.am> --play [--assets <dir>] [--ws-port <port>]
  daw_engine --doc <file.am> --render <output.wav> [--assets <dir>]
  daw_engine --doc <file.am> --info

Options:
  --server <url>     Sync server URL (e.g., ws://localhost:3000)
  --project <id>     Project ID for server sync (default: 'default')
  --doc <file>       Project document file (Automerge binary .am)
  --play             Play the project through audio device
  --start-stopped    With --play: device up, transport stopped until a PLAY command
  --exclusive        WASAPI exclusive mode (period honored, readback logged)
  --buffer-size <n>  Requested device period in frames (default 512)
  --editors          Open each VST3 plugin's native GUI window
  --vst3-dir <dir>   Scan a VST3 folder (repeatable; cached, crash-isolated)
  --vst3-module <uid>=<path.vst3>
                     Resolve a chain node (class uid) to a module (repeatable)
  --render <file>    Render to WAV file
  --probe <file>     With --render: per-stage audio proof JSON (peak/rms/hash
                     between every chain node of every track)
  --assets <dir>     Directory containing audio assets (default: same as doc)
  --info             Show project information
  --mute             Use null audio backend (silent playback for testing)
  --keepalive        File mode: loop the document instead of exiting at its end
  --sample-rate <n>  Sample rate for rendering (default: 48000)
  --bit-depth <n>    Bit depth for rendering (16, 24, 32; default: 24)
  --ws-port <n>      WebSocket server port (default: 47821)
  --allow-origin <o> Allow an extra browser Origin on the WebSocket (repeatable)
  --solo <track-id>  Solo specified track (repeatable)
  --mute-track <id>  Mute specified track (repeatable)
  --list-devices     List available audio devices and exit
  --device <name>    Select audio device by name (substring match)
```

`--doc` and `--server` are mutually exclusive; `--render`/`--info` require
`--doc`. `daw_engine --help` is authoritative (debug hooks such as
`--debug-proxy-again` are listed there). The engine token is written to
`%TEMP%\daw-engine-token-<port>` (JSON) and delivered to the page by
`scripts\daw.ps1`.

## Document Format

See `docs/SCHEMA.md` for the complete schema specification (v2 is
additive over v1: musical fields in ticks appear beside absolute
samples; a pure v1 document never changes).

Minimal v1 example:

```json
{
  "schemaVersion": 1,
  "sampleRate": 48000,
  "tracks": [
    {
      "id": "track-1",
      "name": "Drums",
      "gain": 1.0,
      "clips": [
        {
          "id": "clip-1",
          "assetHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
          "startSample": 0,
          "lengthSamples": 48000,
          "offsetSamples": 0
        }
      ],
      "chain": []
    }
  ]
}
```

## Key Design Decisions

See `docs/DECISIONS.md` for detailed rationale.

- **Audio thread is sacred:** No allocations, no locks, no syscalls
- **Document ownership:** Browser owns the document, engine projects it
  (except stem/state hashes, authored only by the engine hosting the plugin)
- **Integer timing:** All positions are int64 — samples, or ticks resolved
  by the shared integer tempo kernel — never float seconds
- **Graph as projection:** Rebuilt on every document change, atomic swap
- **Plugins out of process (ADR-017), audio never through the server,
  stems for peers without the plugin (ADR-019)**

Working regime for contributors and for the AI session that develops the
project: `CLAUDE.md`. Current state: `STATUS.md`. Queue: `TODO.md`.

## Development

### Run Tests

```bash
# Engine (MSVC, native — the only local toolchain)
cd engine/build-msvc && ..\rebuild_msvc.bat && .\daw_engine_test.exe

# Web E2E (Playwright; server + vite must be running)
cd web && npm run test:e2e
```

### Build in Debug Mode

```bash
mkdir -p build/engine-debug
cd build/engine-debug
cmake ../../engine -DCMAKE_BUILD_TYPE=Debug -DDAW_ENABLE_ASAN=ON
cmake --build .
```

### Format Code

```bash
# C++
clang-format -i engine/src/**/*.cpp engine/src/**/*.h

# Rust
cd server && cargo fmt

# TypeScript
cd web && npm run format
```


## Licence

GPL-3.0-or-later — voir [LICENSE](LICENSE). Le SDK VST3 (double licence GPLv3/Steinberg) est consomme sous sa branche GPLv3 ; il reste hors depot (third_party/, non commite).
