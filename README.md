# DAW Hybrid - Slice 1

A hybrid DAW architecture with three tiers: browser (UI), server (sync), and native engine (audio).

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
      ▲                                               │
      │              WebSocket (Protobuf)             │
      └───────────────────────────────────────────────┘
```

## Slice 1 Scope

**Goal:** Two browser tabs open on the same project. Move a fader in tab A, it moves in tab B, and the sound changes in headphones.

**Features:**
- Load project documents (JSON format)
- Play WAV clips with sample-accurate positioning
- Apply gain (track-level and processor chain)
- Offline render to WAV
- CLI for testing without browser

**Not included:** VST plugins, recording, MIDI, undo, fancy UI.

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

```bash
# 1. Generate test fixtures
cd fixtures/generator
npm install
npm run generate
cd ../..

# 2. Build engine
mkdir -p build/engine
cd build/engine
cmake ../../engine -DCMAKE_BUILD_TYPE=Release
cmake --build . -j$(nproc)
cd ../..

# 3. Test playback
./build/engine/daw_engine --doc fixtures/two-tracks.json --play --assets fixtures

# 4. Test offline render
./build/engine/daw_engine --doc fixtures/two-tracks.json --render output.wav --assets fixtures
```

## Acceptance Criteria Verification

### 1. Deterministic WAV Rendering

```bash
# Render twice and compare hashes
./build/engine/daw_engine --doc fixtures/two-tracks.json --render /tmp/out1.wav --assets fixtures
./build/engine/daw_engine --doc fixtures/two-tracks.json --render /tmp/out2.wav --assets fixtures

# Hashes must match
sha256sum /tmp/out1.wav /tmp/out2.wav
```

### 2. CLI Integration Test

```bash
./build/engine/daw_engine_test fixtures
```

### 3. Two-Tab Sync (Phase 3+)

```bash
# Terminal 1: Start server
cd server && cargo run

# Terminal 2: Start web client
cd web && npm run dev

# Open http://localhost:5173 in two browser tabs
# Modify gain in one tab, observe change in the other
```

### 4. Chrome Local Network Access (Phase 3+)

See `docs/DECISIONS.md` ADR-008 for investigation results.

### 5. 10-Minute Stability Test

```bash
# Create a long project and play for 10 minutes
./build/engine/daw_engine --doc fixtures/long-project.json --play --assets fixtures

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
    /document   Automerge wrapper
    /network    WebSocket clients
    /ui         Fader, transport, meters

/proto      Protobuf schemas
/docs       Architecture decisions, schema
/fixtures   Test files
```

## Engine CLI Reference

```
Usage:
  engine --doc <file> --play [--assets <dir>]
  engine --doc <file> --render <output.wav> [--assets <dir>]
  engine --doc <file> --info

Options:
  --doc <file>       Project document (.json)
  --play             Play through audio device
  --render <file>    Render to WAV file
  --assets <dir>     Asset directory (default: same as doc)
  --info             Show project info
  --sample-rate <n>  Sample rate (default: 48000)
  --bit-depth <n>    Bit depth: 16, 24, 32 (default: 24)
```

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
          "assetHash": "a948904f2f0f479b",
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
make test
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

## License

[To be determined]
