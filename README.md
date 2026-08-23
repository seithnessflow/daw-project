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
assets are content-addressed by SHA-256 in a verifying store; nothing
real-time crosses the remote server.

## Scope so far

**Foundational milestone:** two browser tabs on the same project — move a
fader in tab A, it moves in tab B, and the sound changes; a VST3 plugin
runs in an isolated process and its bypass is audible from a tab.

**Features:**
- Project documents = Automerge binary (`.am`), collaborative CRDT
- Play WAV clips with sample-accurate positioning
- Per-track gain + out-of-process VST3 chain with bypass
- Offline render to WAV (deterministic: same document = same hash)
- Timeline UI (clips, drag/resize, waveforms, overview, drop-your-WAV)
- CLI for testing without a browser

**Not yet:** recording, MIDI, undo, tempo/bars, automation (see TODO
roadmap and docs/ABLETON-INTEGRALE.md).

## Prerequisites

- **CMake** 3.20+
- **C++ compiler** with C++20 support (GCC 10+, Clang 12+, MSVC 2019+)
- **Rust** toolchain (for automerge-c and server)
- **Node.js** 18+ (for web client and fixture generation)
- **Protobuf** compiler (`protoc`)

### Install on Ubuntu/Debian

```bash
sudo apt update
sudo apt install cmake build-essential protobuf-compiler
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs
```

### Install on macOS

```bash
brew install cmake protobuf node rust
```

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

## Acceptance Criteria Verification

### 1. Deterministic WAV Rendering

```bash
# Render twice and compare hashes (the reference hash 56729beb61993cd7 is
# asserted inside daw_engine_test; see docs/DECISIONS.md)
./engine/build/daw_engine --doc engine/test-assets/test.am --render /tmp/out1.wav --assets engine/test-assets
./engine/build/daw_engine --doc engine/test-assets/test.am --render /tmp/out2.wav --assets engine/test-assets
sha256sum /tmp/out1.wav /tmp/out2.wav
```

### 2. CLI Integration Test

```bash
./engine/build/daw_engine_test          # 21 tests, no browser needed
```

### 3. Two-Tab Sync

```bash
# Terminal 1: Start server
cd server && cargo run

# Terminal 2: Start web client
cd web && npm run dev

# Open http://localhost:5173 in two browser tabs
# Modify gain in one tab, observe change in the other
```

### 4. Chrome Local Network Access

See `docs/DECISIONS.md` ADR-008 for investigation results (still untested).

### 5. 10-Minute Stability Test

```bash
# Play a long project for 10 minutes (fixtures/test10min.am is tracked;
# regenerate its asset with create_test_doc if missing)
./engine/build/daw_engine --doc fixtures/test10min.am --play --assets fixtures

# Monitor the "Underruns" counter - should stay at 0
```

## Project Structure

```
/engine     C++ audio engine
  /src
    /audio      Audio device, callback, ring buffer
    /graph      Audio graph, processors, clip player
    /document   Automerge wrapper, schema
    /transport  Play/stop/seek state
    /render     Offline rendering

/server     Rust sync server
  /src
    /api        WebSocket handlers
    /document   Automerge relay, persistence

/web        TypeScript web client
  /src
    /app        Wiring, gestures, rendering
    /document   Automerge wrapper
    /network    WebSocket clients
    /proto      Generated protobuf code (npm run proto:gen)
    /ui         Timeline, tracks, meters, life layer

/scripts     Stack launchers (daw.ps1, start-stack.ps1)
/third_party Pinned SDKs (VST3, automerge) - not committed
/docs        Architecture decisions, schema
/fixtures    Test files
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
  --render <file>    Render to WAV file
  --assets <dir>     Directory containing audio assets (default: same as doc)
  --info             Show project information
  --mute             Use null audio backend (silent playback for testing)
  --sample-rate <n>  Sample rate for rendering (default: 48000)
  --bit-depth <n>    Bit depth for rendering (16, 24, 32; default: 24)
  --ws-port <n>      WebSocket server port (default: 47821)
  --vst3-module <uid>=<path.vst3>
                     Resolve a VST3 class uid to a module path (repeatable)
  --allow-origin <o> Allow an extra browser Origin on the WebSocket
  --solo <track-id>  Solo specified track (repeatable)
  --mute-track <id>  Mute specified track (repeatable)
  --list-devices     List available audio devices and exit
  --device <name>    Select audio device by name (substring match)
```

`--doc` and `--server` are mutually exclusive; `--render`/`--info` require
`--doc`. Debug flags (`--debug-proxy-again`, `--debug-rebuild-delay-ms`)
are listed by `daw_engine --help`.

## Document Format

See `docs/SCHEMA.md` for the complete schema specification.

Example:

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
- **Sample-based timing:** All positions in int64 samples, never float seconds
- **Graph as projection:** Rebuilt on every document change, atomic swap

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
