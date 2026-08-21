// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file cli_integration_test.cpp
 * @brief Integration tests for DAW engine.
 *
 * These tests verify the engine produces correct output without a GUI.
 */

#include "../src/document/automerge_document.h"
#include "../src/document/schema.h"
#include "../src/graph/audio_graph.h"
#include "../src/graph/clip_player.h"
#include "../src/render/offline_render.h"
#include "../src/audio/ring_buffer.h"
#include "../src/websocket/websocket_server.h"

#include <ixwebsocket/IXNetSystem.h>
#include <ixwebsocket/IXWebSocket.h>

#include <atomic>
#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <sstream>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

// Test utilities
namespace {

bool fileExists(const std::string& path) {
    return fs::exists(path);
}

size_t fileSize(const std::string& path) {
    return fs::file_size(path);
}

std::string computeFileHash(const std::string& path) {
    // Simple FNV-1a hash for testing
    std::ifstream file(path, std::ios::binary);
    if (!file) return "";

    uint64_t hash = 0xcbf29ce484222325ULL;
    constexpr uint64_t prime = 0x100000001b3ULL;

    char buffer[4096];
    while (file.read(buffer, sizeof(buffer))) {
        for (size_t i = 0; i < sizeof(buffer); ++i) {
            hash ^= static_cast<uint8_t>(buffer[i]);
            hash *= prime;
        }
    }
    for (std::streamsize i = 0; i < file.gcount(); ++i) {
        hash ^= static_cast<uint8_t>(buffer[i]);
        hash *= prime;
    }

    char hex[17];
    snprintf(hex, sizeof(hex), "%016llx", static_cast<unsigned long long>(hash));
    return hex;
}

// Read WAV file and return samples as float
std::vector<float> readWavSamples(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) return {};

    // Skip header (44 bytes for standard WAV)
    file.seekg(44);

    std::vector<float> samples;
    int16_t sample;
    while (file.read(reinterpret_cast<char*>(&sample), sizeof(sample))) {
        samples.push_back(static_cast<float>(sample) / 32768.0f);
    }

    return samples;
}

// Poll a predicate until it holds or the timeout expires
bool waitFor(const std::function<bool()>& pred, int timeout_ms) {
    const auto deadline = std::chrono::steady_clock::now() +
                          std::chrono::milliseconds(timeout_ms);
    while (std::chrono::steady_clock::now() < deadline) {
        if (pred()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    return pred();
}

// Minimal WebSocket test client tracking open/close state
struct TestWsClient {
    ix::WebSocket ws;
    std::atomic<bool> open{false};
    std::atomic<bool> closed{false};
    std::atomic<int> close_code{0};

    // ixwebsocket only generates an Origin header if none is given, so the
    // origin parameter fully controls what the server sees.
    explicit TestWsClient(const std::string& url, const std::string& origin) {
        ws.setUrl(url);
        ws.setExtraHeaders({{"Origin", origin}});
        ws.disableAutomaticReconnection();
        ws.setOnMessageCallback([this](const ix::WebSocketMessagePtr& m) {
            if (m->type == ix::WebSocketMessageType::Open) {
                open = true;
            } else if (m->type == ix::WebSocketMessageType::Close) {
                close_code = static_cast<int>(m->closeInfo.code);
                closed = true;
            }
        });
        ws.start();
    }

    ~TestWsClient() {
        ws.stop();
    }

    void sendAuth(const std::string& token) {
        std::string msg;
        msg.push_back('\x00');
        msg += token;
        ws.sendBinary(msg);
    }
};

// Extract the token value from the JSON token file the server writes
std::string readTokenFromFile(const std::string& path) {
    std::ifstream f(path);
    if (!f) return "";
    std::stringstream ss;
    ss << f.rdbuf();
    const std::string content = ss.str();

    const std::string key = "\"token\": \"";
    const auto pos = content.find(key);
    if (pos == std::string::npos) return "";
    const auto start = pos + key.size();
    const auto end = content.find('"', start);
    if (end == std::string::npos) return "";
    return content.substr(start, end - start);
}

}  // namespace

// Test 1: Document creation
bool testDocumentCreation() {
    std::cout << "Test: Document creation... ";

    daw::document::AutomergeDocument doc;

    if (!doc.create(48000)) {
        std::cout << "FAILED: " << doc.getLastError() << "\n";
        return false;
    }

    const auto& project = doc.getDocument();
    if (project.schema_version != daw::document::SCHEMA_VERSION ||
        project.sample_rate != 48000) {
        std::cout << "FAILED: Incorrect data\n";
        return false;
    }

    std::cout << "OK\n";
    return true;
}

// Test 2: Track management
bool testTrackManagement() {
    std::cout << "Test: Track management... ";

    daw::document::AutomergeDocument doc;
    if (!doc.create(48000)) {
        std::cout << "FAILED: Create failed\n";
        return false;
    }

    // Add a track
    daw::document::TrackDef track;
    track.id = "track-1";
    track.name = "Test Track";
    track.gain = 1.0f;

    if (!doc.addTrack(track)) {
        std::cout << "FAILED: Add track failed\n";
        return false;
    }

    const auto& project = doc.getDocument();
    if (project.tracks.size() != 1 ||
        project.tracks[0].name != "Test Track") {
        std::cout << "FAILED: Track not added correctly\n";
        return false;
    }

    // Modify gain
    if (!doc.setTrackGain("track-1", 0.5f)) {
        std::cout << "FAILED: Set gain failed\n";
        return false;
    }

    const auto& project2 = doc.getDocument();
    if (std::fabs(project2.tracks[0].gain - 0.5f) > 0.01f) {
        std::cout << "FAILED: Gain not set correctly\n";
        return false;
    }

    std::cout << "OK\n";
    return true;
}

// Test 3: Audio graph construction
bool testAudioGraphConstruction() {
    std::cout << "Test: Audio graph construction... ";

    daw::graph::AudioGraph graph;
    graph.setSampleRate(48000);

    daw::graph::AudioTrack track;
    track.id = "track-1";
    track.name = "Test Track";
    track.gain = 1.0f;

    auto gain_node = std::make_unique<daw::graph::GainNode>("gain-1", 0.5f);
    track.chain.push_back(std::move(gain_node));

    graph.addTrack(std::move(track));
    graph.prepare(48000, 512);

    if (graph.getTrackCount() != 1) {
        std::cout << "FAILED: Wrong track count\n";
        return false;
    }

    auto* retrieved = graph.getTrackById("track-1");
    if (!retrieved || retrieved->name != "Test Track") {
        std::cout << "FAILED: Track lookup failed\n";
        return false;
    }

    std::cout << "OK\n";
    return true;
}

// Test 4: Gain node processing
bool testGainNodeProcessing() {
    std::cout << "Test: Gain node processing... ";

    daw::graph::GainNode node("gain-1", 0.5f);
    node.prepare(48000, 512);

    // Input: all 1.0
    std::vector<float> buffer(512 * 2, 1.0f);
    node.process(buffer.data(), buffer.data(), 512, 0);

    // After a few samples, smoothed gain should approach 0.5
    // The final samples should be close to 0.5
    float final_sample = buffer[buffer.size() - 2];
    if (std::fabs(final_sample - 0.5f) > 0.01f) {
        std::cout << "FAILED: Expected ~0.5, got " << final_sample << "\n";
        return false;
    }

    std::cout << "OK\n";
    return true;
}

// Test 5: SPSC ring buffer
bool testRingBuffer() {
    std::cout << "Test: SPSC ring buffer... ";

    daw::audio::RingBuffer<int, 16> buffer;

    // Push 10 items
    for (int i = 0; i < 10; ++i) {
        if (!buffer.push(i)) {
            std::cout << "FAILED: Push failed at " << i << "\n";
            return false;
        }
    }

    if (buffer.size() != 10) {
        std::cout << "FAILED: Size wrong\n";
        return false;
    }

    // Pop 5 items
    for (int i = 0; i < 5; ++i) {
        auto val = buffer.pop();
        if (!val || *val != i) {
            std::cout << "FAILED: Pop wrong value\n";
            return false;
        }
    }

    if (buffer.size() != 5) {
        std::cout << "FAILED: Size after pop wrong\n";
        return false;
    }

    std::cout << "OK\n";
    return true;
}

// Test 6: Document serialization
bool testDocumentSerialization() {
    std::cout << "Test: Document serialization... ";

    daw::document::AutomergeDocument doc1;
    if (!doc1.create(48000)) {
        std::cout << "FAILED: Create failed\n";
        return false;
    }

    // Add a track
    daw::document::TrackDef track;
    track.id = "track-1";
    track.name = "Test Track";
    track.gain = 0.75f;
    doc1.addTrack(track);

    // Serialize
    std::vector<uint8_t> bytes = doc1.toBytes();
    if (bytes.empty()) {
        std::cout << "FAILED: Serialization failed\n";
        return false;
    }

    // Deserialize
    daw::document::AutomergeDocument doc2;
    if (!doc2.loadFromBytes(bytes.data(), bytes.size())) {
        std::cout << "FAILED: Deserialization failed: " << doc2.getLastError() << "\n";
        return false;
    }

    const auto& project = doc2.getDocument();
    if (project.tracks.size() != 1 ||
        project.tracks[0].name != "Test Track" ||
        std::fabs(project.tracks[0].gain - 0.75f) > 0.01f) {
        std::cout << "FAILED: Data mismatch after deserialization\n";
        return false;
    }

    std::cout << "OK\n";
    return true;
}

// Test 7: Document clips round-trip
bool testDocumentClipsRoundTrip() {
    std::cout << "Test: Document clips round-trip... ";

    daw::document::AutomergeDocument doc1;
    if (!doc1.create(48000)) {
        std::cout << "FAILED: Create failed\n";
        return false;
    }

    // Create track with clips
    daw::document::TrackDef track;
    track.id = "track-1";
    track.name = "Track with Clips";
    track.gain = 0.8f;

    daw::document::ClipDef clip1;
    clip1.id = "clip-1";
    clip1.asset_hash = "abc123def456";
    clip1.start_sample = 0;
    clip1.length_samples = 48000;  // 1 second
    clip1.offset_samples = 0;
    track.clips.push_back(clip1);

    daw::document::ClipDef clip2;
    clip2.id = "clip-2";
    clip2.asset_hash = "xyz789";
    clip2.start_sample = 48000;
    clip2.length_samples = 96000;  // 2 seconds
    clip2.offset_samples = 24000;
    track.clips.push_back(clip2);

    if (!doc1.addTrack(track)) {
        std::cout << "FAILED: addTrack failed: " << doc1.getLastError() << "\n";
        return false;
    }

    // Serialize
    std::vector<uint8_t> bytes = doc1.toBytes();
    if (bytes.empty()) {
        std::cout << "FAILED: Serialization failed\n";
        return false;
    }

    // Deserialize
    daw::document::AutomergeDocument doc2;
    if (!doc2.loadFromBytes(bytes.data(), bytes.size())) {
        std::cout << "FAILED: Deserialization failed: " << doc2.getLastError() << "\n";
        return false;
    }

    // Verify clips
    const auto& project = doc2.getDocument();
    if (project.tracks.size() != 1) {
        std::cout << "FAILED: Expected 1 track, got " << project.tracks.size() << "\n";
        return false;
    }

    const auto& loaded_track = project.tracks[0];
    if (loaded_track.clips.size() != 2) {
        std::cout << "FAILED: Expected 2 clips, got " << loaded_track.clips.size() << "\n";
        return false;
    }

    // Check clip 1
    const auto& c1 = loaded_track.clips[0];
    if (c1.id != "clip-1" || c1.asset_hash != "abc123def456" ||
        c1.start_sample != 0 || c1.length_samples != 48000 || c1.offset_samples != 0) {
        std::cout << "FAILED: Clip 1 data mismatch\n";
        std::cout << "  id: " << c1.id << " (expected clip-1)\n";
        std::cout << "  hash: " << c1.asset_hash << " (expected abc123def456)\n";
        std::cout << "  start: " << c1.start_sample << " (expected 0)\n";
        std::cout << "  length: " << c1.length_samples << " (expected 48000)\n";
        std::cout << "  offset: " << c1.offset_samples << " (expected 0)\n";
        return false;
    }

    // Check clip 2
    const auto& c2 = loaded_track.clips[1];
    if (c2.id != "clip-2" || c2.asset_hash != "xyz789" ||
        c2.start_sample != 48000 || c2.length_samples != 96000 || c2.offset_samples != 24000) {
        std::cout << "FAILED: Clip 2 data mismatch\n";
        return false;
    }

    std::cout << "OK\n";
    return true;
}

// Test 8: Offline render determinism
// Write a 16-bit PCM WAV file from interleaved samples
bool writeWav16(const std::string& path,
                uint16_t channels,
                uint32_t sample_rate,
                const std::vector<int16_t>& samples) {
    std::ofstream file(path, std::ios::binary);
    if (!file) return false;

    const uint32_t data_size = static_cast<uint32_t>(samples.size() * 2);
    const uint16_t block_align = channels * 2;
    const uint32_t byte_rate = sample_rate * block_align;
    const uint32_t chunk_size = 36 + data_size;
    const uint32_t fmt_size = 16;
    const uint16_t pcm = 1;
    const uint16_t bits = 16;

    file.write("RIFF", 4);
    file.write(reinterpret_cast<const char*>(&chunk_size), 4);
    file.write("WAVE", 4);
    file.write("fmt ", 4);
    file.write(reinterpret_cast<const char*>(&fmt_size), 4);
    file.write(reinterpret_cast<const char*>(&pcm), 2);
    file.write(reinterpret_cast<const char*>(&channels), 2);
    file.write(reinterpret_cast<const char*>(&sample_rate), 4);
    file.write(reinterpret_cast<const char*>(&byte_rate), 4);
    file.write(reinterpret_cast<const char*>(&block_align), 2);
    file.write(reinterpret_cast<const char*>(&bits), 2);
    file.write("data", 4);
    file.write(reinterpret_cast<const char*>(&data_size), 4);
    file.write(reinterpret_cast<const char*>(samples.data()),
               static_cast<std::streamsize>(data_size));
    return file.good();
}

// Write a WAV asset and expose it under the <hash>.wav name the engine
// resolves. Returns the hash ("" on failure).
std::string writeHashedAsset(const fs::path& dir,
                             uint16_t channels,
                             const std::vector<int16_t>& samples) {
    const fs::path tmp = dir / "asset.tmp.wav";
    if (!writeWav16(tmp.string(), channels, 48000, samples)) return "";
    const std::string hash = computeFileHash(tmp.string());
    if (hash.empty()) return "";
    std::error_code ec;
    fs::rename(tmp, dir / (hash + ".wav"), ec);
    if (ec) return "";
    return hash;
}

bool testRenderDeterminism(const std::string& /*fixtures_dir*/) {
    std::cout << "Test: Render determinism... ";

    // Self-contained fixture with REAL audio content. The waveforms use
    // exact integer arithmetic only (no libm sin(): its last-ulp results
    // differ between toolchains and would break the MSVC/GCC hash match).
    const fs::path dir = fs::temp_directory_path() / "daw-determinism-fixture";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir);

    // Asset A: stereo square wave, period 96 samples (500 Hz), 24000 frames.
    // Right channel inverted so the channels are distinguishable.
    std::vector<int16_t> square(24000 * 2);
    for (size_t i = 0; i < 24000; ++i) {
        const int16_t v = (i % 96 < 48) ? int16_t{8192} : int16_t{-8192};
        square[i * 2] = v;
        square[i * 2 + 1] = static_cast<int16_t>(-v);
    }

    // Asset B: mono sawtooth, period 150 samples (320 Hz), 30000 frames.
    // Mono exercises the mono-to-stereo path.
    std::vector<int16_t> saw(30000);
    for (size_t i = 0; i < 30000; ++i) {
        saw[i] = static_cast<int16_t>(-16350 + static_cast<int>(i % 150) * 218);
    }

    const std::string hashA = writeHashedAsset(dir, 2, square);
    const std::string hashB = writeHashedAsset(dir, 1, saw);
    if (hashA.empty() || hashB.empty()) {
        std::cout << "FAILED: Could not write fixture assets\n";
        return false;
    }

    // Two tracks, different gains, overlapping clips, one nonzero offset:
    // exercises clip playback, offsets, mixing and per-track gain.
    daw::document::AutomergeDocument doc;
    if (!doc.create(48000)) {
        std::cout << "FAILED: Document creation failed\n";
        return false;
    }

    daw::document::TrackDef track1;
    track1.id = "track-1";
    track1.name = "Square";
    track1.gain = 0.8f;
    daw::document::ClipDef clip1;
    clip1.id = "clip-1";
    clip1.asset_hash = hashA;
    clip1.start_sample = 0;
    clip1.length_samples = 24000;
    clip1.offset_samples = 0;
    track1.clips.push_back(clip1);
    doc.addTrack(track1);

    daw::document::TrackDef track2;
    track2.id = "track-2";
    track2.name = "Saw";
    track2.gain = 0.3f;
    daw::document::ClipDef clip2;
    clip2.id = "clip-2";
    clip2.asset_hash = hashB;
    clip2.start_sample = 12000;
    clip2.length_samples = 24000;
    clip2.offset_samples = 2000;
    track2.clips.push_back(clip2);
    doc.addTrack(track2);

    daw::render::RenderConfig config;
    config.sample_rate = 48000;
    config.bit_depth = 16;
    config.end_sample = -1;  // Project length: 36000 samples

    daw::render::OfflineRenderer renderer;

    // Render twice
    std::string out1 = (dir / "render_1.wav").string();
    std::string out2 = (dir / "render_2.wav").string();

    auto result1 = renderer.render(doc, out1, dir.string(), config);
    auto result2 = renderer.render(doc, out2, dir.string(), config);

    // The fixture must actually produce audio: a silent render would prove
    // nothing about the audio path (the pre-2026-08-21 reference hash was
    // exactly that - a hash of silence; see DECISIONS.md).
    if (result1.success &&
        (result1.peak_left <= 0.05 || result1.peak_right <= 0.05)) {
        std::cout << "FAILED: Fixture rendered (near-)silence, peaks L="
                  << result1.peak_left << " R=" << result1.peak_right << "\n";
        return false;
    }

    if (!result1.success || !result2.success) {
        std::cout << "FAILED: Render failed: " << result1.error << " / " << result2.error << "\n";
        // Cleanup
        fs::remove(out1);
        fs::remove(out2);
        return false;
    }

    // Compare hashes
    std::string hash1 = computeFileHash(out1);
    std::string hash2 = computeFileHash(out2);

    // Cleanup
    fs::remove(out1);
    fs::remove(out2);

    if (hash1 != hash2) {
        std::cout << "FAILED: Hashes differ\n";
        std::cout << "  Hash 1: " << hash1 << "\n";
        std::cout << "  Hash 2: " << hash2 << "\n";
        return false;
    }

    // Criterion 1 reference hash (STATUS.md / DECISIONS.md). A deviation is
    // a rendering regression and must FAIL, in CI included. Update this
    // constant only for a deliberate, documented rendering change.
    // 2026-08-21: reference recomputed on a REAL fixture (two tracks, square
    // + sawtooth, gains 0.8/0.3). The previous value f40af882097b704a was a
    // hash of silence (clipless document) and proved nothing.
    const std::string expected_hash = "89f1a1105dc09e92";
    if (hash1 != expected_hash) {
        std::cout << "FAILED: Hash deviates from reference\n";
        std::cout << "  Got:      " << hash1 << "\n";
        std::cout << "  Expected: " << expected_hash << "\n";
        return false;
    }

    std::cout << "OK (hash: " << hash1 << ")\n";
    return true;
}

// Main
// Test 9b: Sacred-thread lock-freedom, verified at RUNTIME on this exact
// toolchain (the compile-time is_always_lock_free asserts live in
// audio_callback.h). Guards against the AUDIT-2 R4 family: a type shared
// with the audio callback whose atomic silently takes a lock.
bool testAudioThreadLockFreedom() {
    std::cout << "Test: Audio-thread lock-freedom... ";

    std::atomic<daw::graph::AudioGraph*> graph_ptr{nullptr};
    std::atomic<uint64_t> gen{0};
    std::atomic<int64_t> pos{0};
    std::atomic<bool> flag{false};
    std::atomic<float> gain{1.0f};

    const bool ok = graph_ptr.is_lock_free() && gen.is_lock_free() &&
                    pos.is_lock_free() && flag.is_lock_free() &&
                    gain.is_lock_free();
    if (!ok) {
        std::cout << "FAILED: an audio-shared atomic is NOT lock-free on this toolchain\n";
        return false;
    }

    // The type that betrayed us once - informational, banned from the
    // callback regardless of what this prints
    std::atomic<std::shared_ptr<daw::graph::AudioGraph>> sp;
    std::cout << "OK (atomic<shared_ptr>.is_lock_free()="
              << (sp.is_lock_free() ? 1 : 0) << ", banned from callback)\n";
    return true;
}

// Test 9: WebSocket authentication
// A connection is accepted only if its FIRST message is [0x00][valid token].
// Bad token -> close 4001. Silence -> close 4001 after the 2s deadline.
bool testWebSocketAuth() {
    std::cout << "Test: WebSocket auth... " << std::flush;

    ix::initNetSystem();

    daw::websocket::WebSocketServer server;
    daw::websocket::WebSocketConfig cfg;
    cfg.port = 47899;
    cfg.bind_address = "127.0.0.1";
    cfg.token_file_path =
        (fs::temp_directory_path() / "daw-engine-test-token").string();

    daw::audio::AudioDevice device;  // Not initialized: auth needs no audio
    std::atomic<std::shared_ptr<daw::graph::AudioGraph>> graph_slot;

    if (!server.start(cfg, &device, &graph_slot)) {
        std::cout << "FAILED: server did not start\n";
        return false;
    }

    const std::string url = "ws://127.0.0.1:47899/";
    const std::string good_origin = "http://localhost:5173";  // In default allowlist
    bool ok = true;
    std::string reason;

    // Case 1: wrong token must be rejected with 4001
    {
        TestWsClient client(url, good_origin);
        if (!waitFor([&] { return client.open.load(); }, 3000)) {
            ok = false;
            reason = "could not connect (bad-token case)";
        } else {
            client.sendAuth("wrong-token");
            if (!waitFor([&] { return client.closed.load(); }, 3000)) {
                ok = false;
                reason = "bad token was NOT rejected";
            } else if (client.close_code != 4001) {
                ok = false;
                reason = "bad token closed with code " +
                         std::to_string(client.close_code.load()) + " (expected 4001)";
            }
        }
    }

    // Case 2: valid token must be accepted (still open past the auth deadline)
    if (ok) {
        const std::string token = readTokenFromFile(cfg.token_file_path);
        if (token.empty()) {
            ok = false;
            reason = "could not read token file";
        } else {
            TestWsClient client(url, good_origin);
            if (!waitFor([&] { return client.open.load(); }, 3000)) {
                ok = false;
                reason = "could not connect (good-token case)";
            } else {
                client.sendAuth(token);
                // Wait past the 2s auth deadline: an authenticated
                // connection must survive it
                std::this_thread::sleep_for(std::chrono::milliseconds(2600));
                if (client.closed.load()) {
                    ok = false;
                    reason = "valid token was rejected (code " +
                             std::to_string(client.close_code.load()) + ")";
                }
            }
        }
    }

    // Case 3: silent connection must be closed 4001 after the deadline
    if (ok) {
        TestWsClient client(url, good_origin);
        if (!waitFor([&] { return client.open.load(); }, 3000)) {
            ok = false;
            reason = "could not connect (timeout case)";
        } else if (!waitFor([&] { return client.closed.load(); }, 4000)) {
            ok = false;
            reason = "silent connection was NOT closed";
        } else if (client.close_code != 4001) {
            ok = false;
            reason = "timeout closed with code " +
                     std::to_string(client.close_code.load()) + " (expected 4001)";
        }
    }

    // Case 4: disallowed browser Origin must be rejected even before auth
    if (ok) {
        TestWsClient client(url, "http://evil.example");
        if (!waitFor([&] { return client.closed.load(); }, 3000)) {
            ok = false;
            reason = "disallowed origin was NOT rejected";
        } else if (client.close_code != 4001) {
            ok = false;
            reason = "disallowed origin closed with code " +
                     std::to_string(client.close_code.load()) + " (expected 4001)";
        }
    }

    server.stop();

    if (!ok) {
        std::cout << "FAILED: " << reason << "\n";
        return false;
    }
    std::cout << "OK\n";
    return true;
}

int main(int argc, char* argv[]) {
    std::cout << "=== DAW Engine Integration Tests ===\n\n";

    std::string fixtures_dir = ".";
    if (argc > 1) {
        fixtures_dir = argv[1];
    }

    int passed = 0;
    int failed = 0;

    auto run = [&](bool (*test)()) {
        if (test()) ++passed;
        else ++failed;
    };

    auto runWithArg = [&](bool (*test)(const std::string&), const std::string& arg) {
        if (test(arg)) ++passed;
        else ++failed;
    };

    run(testDocumentCreation);
    run(testTrackManagement);
    run(testAudioGraphConstruction);
    run(testGainNodeProcessing);
    run(testRingBuffer);
    run(testDocumentSerialization);
    run(testDocumentClipsRoundTrip);
    runWithArg(testRenderDeterminism, fixtures_dir);
    run(testAudioThreadLockFreedom);
    run(testWebSocketAuth);

    std::cout << "\n=== Results ===\n";
    std::cout << "Passed: " << passed << "\n";
    std::cout << "Failed: " << failed << "\n";

    return failed > 0 ? 1 : 0;
}
