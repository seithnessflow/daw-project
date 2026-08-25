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
#include "../src/graph/utility_node.h"
#include "../src/graph/eq3_node.h"
#include "../src/graph/compressor_node.h"
#include "../src/graph/drive_node.h"
#include "../src/graph/delay_node.h"
#include "../src/graph/plugin_registry.h"
#include "../src/render/offline_render.h"
#include "../src/render/stem_render.h"
#include "../src/audio/audio_callback.h"
#include "../src/audio/ring_buffer.h"
#include "../src/host/plugin_bridge.h"
#include "../src/host/proxy_node.h"
#include "../src/util/sha256.h"
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

// Session 4.1 : Utility - preuves EXACTES exigees par le brief (gain
// -6 dB = peaks exactement halves ; phase = negation exacte ; pan
// balance a centre unite ; mono = (L+R)/2 exact ; rendu deux fois =
// memes octets). Le lisseur demarre SUR la cible : un noeud frais
// multiplie par des constantes, l'exactitude au bit est structurelle.
bool testUtilityNode() {
    std::cout << "Test: Utility node (exact proofs)... ";
    using daw::graph::UtilityNode;

    auto fill = [](std::vector<float>& b) {
        for (size_t i = 0; i < b.size(); i += 2) {
            b[i] = 0.25f;      // L
            b[i + 1] = 0.75f;  // R
        }
    };

    // 1. gain 0.5 (-6.02 dB) : EXACTEMENT la moitie, tous echantillons
    {
        UtilityNode n("u1", 0.5f, 0.0f, false, false);
        n.prepare(48000, 256);
        std::vector<float> b(256 * 2);
        fill(b);
        n.process(b.data(), b.data(), 256, 0);
        for (size_t i = 0; i < b.size(); i += 2) {
            if (b[i] != 0.125f || b[i + 1] != 0.375f) {
                std::cout << "FAILED: gain 0.5 pas exact a l'echantillon "
                          << i << " (" << b[i] << ", " << b[i + 1] << ")\n";
                return false;
            }
        }
    }

    // 2. phase : negation exacte
    {
        UtilityNode n("u2", 1.0f, 0.0f, false, true);
        n.prepare(48000, 256);
        std::vector<float> b(256 * 2);
        fill(b);
        n.process(b.data(), b.data(), 256, 0);
        if (b[0] != -0.25f || b[1] != -0.75f) {
            std::cout << "FAILED: phase pas une negation exacte\n";
            return false;
        }
    }

    // 3. pan balance : centre = identite exacte ; pan -1 = R eteint,
    // L intact (centre unite, jamais -3 dB)
    {
        UtilityNode c("u3", 1.0f, 0.0f, false, false);
        c.prepare(48000, 256);
        std::vector<float> b(256 * 2);
        fill(b);
        c.process(b.data(), b.data(), 256, 0);
        if (b[0] != 0.25f || b[1] != 0.75f) {
            std::cout << "FAILED: pan centre pas identite\n";
            return false;
        }
        UtilityNode l("u4", 1.0f, -1.0f, false, false);
        l.prepare(48000, 256);
        fill(b);
        l.process(b.data(), b.data(), 256, 0);
        if (b[0] != 0.25f || b[1] != 0.0f) {
            std::cout << "FAILED: pan -1 (L=" << b[0] << ", R=" << b[1] << ")\n";
            return false;
        }
    }

    // 4. mono : les deux sorties = (L+R)/2 exact (0.25+0.75)/2 = 0.5
    {
        UtilityNode n("u5", 1.0f, 0.0f, true, false);
        n.prepare(48000, 256);
        std::vector<float> b(256 * 2);
        fill(b);
        n.process(b.data(), b.data(), 256, 0);
        if (b[0] != 0.5f || b[1] != 0.5f) {
            std::cout << "FAILED: mono (" << b[0] << ", " << b[1] << ")\n";
            return false;
        }
    }

    // 5. determinisme : deux noeuds frais, memes octets
    {
        std::vector<float> a(256 * 2), b(256 * 2);
        fill(a);
        fill(b);
        UtilityNode n1("u6", 0.7f, 0.3f, false, false);
        UtilityNode n2("u6", 0.7f, 0.3f, false, false);
        n1.prepare(48000, 256);
        n2.prepare(48000, 256);
        n1.process(a.data(), a.data(), 256, 0);
        n2.process(b.data(), b.data(), 256, 0);
        if (std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) != 0) {
            std::cout << "FAILED: deux rendus frais different\n";
            return false;
        }
    }

    std::cout << "OK\n";
    return true;
}

// Session 4.2 : EQ 3 bandes - reponse MESUREE sur sinus a trois
// frequences, dans la tolerance (brief), + determinisme octets.
bool testEq3Node() {
    std::cout << "Test: EQ3 node (response at 3 freqs)... ";
    using daw::graph::Eq3Node;
    constexpr uint32_t kSr = 48000;
    constexpr uint32_t kN = 48000;  // 1 s

    // low +6 dB @120, peak -6 dB @1000 (Q .9), high +6 dB @6000
    auto measure = [&](double freq) {
        Eq3Node n("eq", 6.0f, 120.0f, -6.0f, 1000.0f, 0.9f, 6.0f, 6000.0f);
        n.prepare(kSr, 256);
        n.reset();
        std::vector<float> b(kN * 2);
        for (uint32_t i = 0; i < kN; ++i) {
            const float v = 0.25f * static_cast<float>(
                std::sin(2.0 * 3.14159265358979323846 * freq * i / kSr));
            b[i * 2] = v;
            b[i * 2 + 1] = v;
        }
        n.process(b.data(), b.data(), kN, 0);
        // RMS de la seconde moitie (regime etabli)
        double acc = 0.0;
        for (uint32_t i = kN / 2; i < kN; ++i) acc += double(b[i * 2]) * b[i * 2];
        const double rms = std::sqrt(acc / (kN / 2));
        const double in_rms = 0.25 / std::sqrt(2.0);
        return 20.0 * std::log10(rms / in_rms);
    };

    struct Point { double f, expected, tol; };
    const Point pts[] = {
        {50.0, 6.0, 1.0},     // plateau du low shelf
        {1000.0, -6.0, 1.0},  // centre du peak
        {12000.0, 6.0, 1.0},  // plateau du high shelf
    };
    for (const auto& p : pts) {
        const double got = measure(p.f);
        if (std::fabs(got - p.expected) > p.tol) {
            std::cout << "FAILED: " << p.f << " Hz attendu " << p.expected
                      << " dB, mesure " << got << " dB\n";
            return false;
        }
    }

    // Determinisme : deux noeuds frais, memes octets
    {
        std::vector<float> a(4096 * 2), b(4096 * 2);
        for (uint32_t i = 0; i < 4096; ++i) {
            const float v = 0.3f * static_cast<float>(
                std::sin(2.0 * 3.14159265358979323846 * 440.0 * i / kSr));
            a[i * 2] = a[i * 2 + 1] = v;
            b[i * 2] = b[i * 2 + 1] = v;
        }
        Eq3Node n1("e", 3.0f, 120.0f, -2.0f, 900.0f, 1.2f, 4.0f, 7000.0f);
        Eq3Node n2("e", 3.0f, 120.0f, -2.0f, 900.0f, 1.2f, 4.0f, 7000.0f);
        n1.prepare(kSr, 256);
        n2.prepare(kSr, 256);
        n1.process(a.data(), a.data(), 4096, 0);
        n2.process(b.data(), b.data(), 4096, 0);
        if (std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) != 0) {
            std::cout << "FAILED: deux rendus frais different\n";
            return false;
        }
    }

    std::cout << "OK\n";
    return true;
}

// Session 4.2 : compresseur - au-dessus du seuil, ratio 4:1 ->
// reduction VERIFIEE NUMERIQUEMENT (brief) ; sous le seuil, identite ;
// determinisme octets.
bool testCompressorNode() {
    std::cout << "Test: Compressor node (4:1 numeric)... ";
    using daw::graph::CompressorNode;
    constexpr uint32_t kSr = 48000;
    constexpr uint32_t kN = 48000;  // 1 s

    // 1. Signal CONSTANT -6.02 dB (l'enveloppe d'un detecteur crete
    // s'assoit EXACTEMENT dessus - un sinus la fait onduler sous la
    // crete et fausserait la theorie), seuil -18, ratio 4 -> sortie
    // attendue thr + over/ratio = -18 + 12/4 = -15 dB, a 0.1 dB pres.
    {
        CompressorNode n("c", -18.0f, 4.0f, 5.0f, 100.0f, 0.0f);
        n.prepare(kSr, 256);
        n.reset();
        std::vector<float> b(kN * 2, 0.5f);
        n.process(b.data(), b.data(), kN, 0);
        double acc = 0.0;
        for (uint32_t i = kN / 2; i < kN; ++i) acc += b[i * 2];
        const double mean = acc / (kN / 2);
        const double out_db = 20.0 * std::log10(mean);
        if (std::fabs(out_db - (-15.0)) > 0.1) {
            std::cout << "FAILED: attendu -15 dB, mesure " << out_db << " dB\n";
            return false;
        }
    }

    // 2. Sous le seuil : identite (gain 1, makeup 0 dB)
    {
        CompressorNode n("c2", -18.0f, 4.0f, 5.0f, 100.0f, 0.0f);
        n.prepare(kSr, 256);
        n.reset();
        std::vector<float> in(4096 * 2), out(4096 * 2);
        for (uint32_t i = 0; i < 4096; ++i) {
            const float v = 0.05f * static_cast<float>(
                std::sin(2.0 * 3.14159265358979323846 * 500.0 * i / kSr));
            in[i * 2] = in[i * 2 + 1] = v;
        }
        out = in;
        n.process(out.data(), out.data(), 4096, 0);
        if (std::memcmp(in.data(), out.data(), in.size() * sizeof(float)) != 0) {
            std::cout << "FAILED: sous le seuil pas une identite\n";
            return false;
        }
    }

    // 3. Determinisme : deux noeuds frais, memes octets
    {
        std::vector<float> a(8192 * 2), b(8192 * 2);
        for (uint32_t i = 0; i < 8192; ++i) {
            const float v = 0.6f * static_cast<float>(
                std::sin(2.0 * 3.14159265358979323846 * 220.0 * i / kSr));
            a[i * 2] = a[i * 2 + 1] = v;
            b[i * 2] = b[i * 2 + 1] = v;
        }
        CompressorNode n1("c3", -20.0f, 3.0f, 8.0f, 80.0f, 3.0f);
        CompressorNode n2("c3", -20.0f, 3.0f, 8.0f, 80.0f, 3.0f);
        n1.prepare(kSr, 256);
        n2.prepare(kSr, 256);
        n1.process(a.data(), a.data(), 8192, 0);
        n2.process(b.data(), b.data(), 8192, 0);
        if (std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) != 0) {
            std::cout << "FAILED: deux rendus frais different\n";
            return false;
        }
    }

    std::cout << "OK\n";
    return true;
}

// Session 4.3 : delay - impulsion -> echo AU BON ECHANTILLON pres,
// decroissance conforme au feedback (brief), determinisme.
bool testDelayNode() {
    std::cout << "Test: Delay node (impulse, sample-exact)... ";
    using daw::graph::DelayNode;
    constexpr uint32_t kSr = 48000;
    constexpr uint32_t kN = 20000;

    DelayNode n("d", 100.0f, 0.5f, 0.5f);  // 100 ms = 4800 ech., fb .5, mix .5
    n.prepare(kSr, 256);
    n.reset();
    std::vector<float> b(kN * 2, 0.0f);
    b[0] = b[1] = 1.0f;  // impulsion
    n.process(b.data(), b.data(), kN, 0);

    struct Hit { uint32_t at; float expected; };
    const Hit hits[] = {
        {0, 0.5f},       // dry
        {4800, 0.5f},    // echo 1 : mix * 1
        {9600, 0.25f},   // echo 2 : mix * fb
        {14400, 0.125f}, // echo 3 : mix * fb^2
    };
    for (const auto& h : hits) {
        if (b[h.at * 2] != h.expected) {
            std::cout << "FAILED: echantillon " << h.at << " attendu "
                      << h.expected << ", lu " << b[h.at * 2] << "\n";
            return false;
        }
    }
    // Entre les echos : silence exact
    for (uint32_t probe : {1u, 4799u, 4801u, 9599u}) {
        if (b[probe * 2] != 0.0f) {
            std::cout << "FAILED: bruit hors echo a " << probe << "\n";
            return false;
        }
    }

    std::cout << "OK\n";
    return true;
}

// Session 4.3 : drive - LE test qui dit si l'oversampling fait son
// travail (brief) : niveau d'alias du 3e harmonique sous un seuil.
// Sinus 15 kHz a 48 kHz : 3e harmonique 45 kHz -> alias a 3 kHz.
bool testDriveNode() {
    std::cout << "Test: Drive node (aliasing under threshold)... ";
    using daw::graph::DriveNode;
    constexpr uint32_t kSr = 48000;
    constexpr uint32_t kSettle = 4800;
    constexpr uint32_t kWin = 4800;   // bins entiers pour 15 kHz et 3 kHz
    constexpr uint32_t kN = kSettle + kWin;
    constexpr double kPi2 = 3.14159265358979323846;

    auto goertzelDb = [](const std::vector<float>& buf, uint32_t start,
                         uint32_t n, double freq, double sr) {
        const double w = 2.0 * kPi2 * freq / sr;
        const double c = 2.0 * std::cos(w);
        double s1 = 0.0, s2 = 0.0;
        for (uint32_t i = 0; i < n; ++i) {
            const double s0 = double(buf[(start + i) * 2]) + c * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        const double p = s1 * s1 + s2 * s2 - c * s1 * s2;
        return 10.0 * std::log10((std::max)(p, 1e-30));
    };

    // 1. Latence declaree = un CALCUL, 16 echantillons pour 65 taps x2
    DriveNode probe("p", 18.0f, 0.0f, 1.0f);
    if (probe.getLatencySamples() != 16) {
        std::cout << "FAILED: latence declaree " << probe.getLatencySamples()
                  << " (attendu 16)\n";
        return false;
    }

    // 2. Alias du drive SOUS le seuil - REGLAGE MUSICAL (drive 12 dB,
    // amp 0.5). Limite PHYSIQUE mesuree et assumee : a saturation
    // quasi-carree, l'harmonique 13 (13 x 15 k = 195 kHz) replie PILE
    // en bande passante (|195k - 4x48k| = 3 kHz) - AUCUN oversampling
    // fini n'y peut rien (verifie : le resampler seul est a -280 dB).
    // Le seuil du brief se mesure la ou l'oversampling PEUT agir ; le
    // naif au MEME reglage prouve que la mesure voit l'alias.
    std::vector<float> b(kN * 2);
    for (uint32_t i = 0; i < kN; ++i) {
        const float v = 0.5f * float(std::sin(2.0 * kPi2 * 15000.0 * i / kSr));
        b[i * 2] = b[i * 2 + 1] = v;
    }
    DriveNode n("dr", 12.0f, 0.0f, 1.0f);
    n.prepare(kSr, 256);
    n.reset();
    n.process(b.data(), b.data(), kN, 0);
    const double fund = goertzelDb(b, kSettle, kWin, 15000.0, kSr);
    const double alias = goertzelDb(b, kSettle, kWin, 3000.0, kSr);
    const double rel = alias - fund;

    // 3. Reference NAIVE (tanh sans oversampling, MEME reglage) :
    // l'alias doit y etre massif - la preuve que la mesure sait le voir
    std::vector<float> naive(kN * 2);
    const double pre = std::pow(10.0, 12.0 / 20.0);
    for (uint32_t i = 0; i < kN; ++i) {
        const double v = 0.5 * std::sin(2.0 * kPi2 * 15000.0 * i / kSr);
        naive[i * 2] = naive[i * 2 + 1] = float(std::tanh(pre * v));
    }
    const double nfund = goertzelDb(naive, kSettle, kWin, 15000.0, kSr);
    const double nalias = goertzelDb(naive, kSettle, kWin, 3000.0, kSr);
    const double nrel = nalias - nfund;

    if (nrel < -40.0) {
        std::cout << "FAILED: la reference naive n'alias pas (" << nrel
                  << " dB) - mesure invalide\n";
        return false;
    }
    if (rel > -60.0) {
        std::cout << "FAILED: alias du drive " << rel
                  << " dB (seuil -60 ; naif " << nrel << ")\n";
        return false;
    }

    // 4. Determinisme
    {
        std::vector<float> a2(8192 * 2), b2(8192 * 2);
        for (uint32_t i = 0; i < 8192; ++i) {
            const float v = 0.8f * float(std::sin(2.0 * kPi2 * 220.0 * i / kSr));
            a2[i * 2] = a2[i * 2 + 1] = v;
            b2[i * 2] = b2[i * 2 + 1] = v;
        }
        DriveNode d1("x", 12.0f, -6.0f, 1.0f), d2("x", 12.0f, -6.0f, 1.0f);
        d1.prepare(kSr, 256);
        d2.prepare(kSr, 256);
        d1.process(a2.data(), a2.data(), 8192, 0);
        d2.process(b2.data(), b2.data(), 8192, 0);
        if (std::memcmp(a2.data(), b2.data(), a2.size() * sizeof(float)) != 0) {
            std::cout << "FAILED: deux rendus frais different\n";
            return false;
        }
    }

    std::cout << "OK (alias " << rel << " dB vs naif " << nrel << " dB)\n";
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

// Test: web-authored (Automerge-JS) documents store integers as INT, not
// UINT. schemaVersion/sampleRate were read with AMitemToUint (strict) and
// fell back silently to the default -> every non-48k project rendered at
// 48k and the v2 migration gate was dead code (AUDIT-5 A1). Repro with
// REAL JS-authored bytes (sampleRate=96000, schemaVersion=2,
// masterGain=0.5). masterGain (read via itemToDouble, which already
// tolerates int/f64) is the POSITIVE CONTROL: it must be read right,
// proving the doc loads and only the strict-uint fields are the bug.
// Bytes: @automerge/automerge, actor a5a5..., time 0 - regenerate with
// the same three values if the schema ever changes.
bool testWebAuthoredIntFields() {
    std::cout << "Test: web-authored int fields (int/f64 read)... ";

    static const uint8_t kWebDoc[] = {
        0x85,0x6f,0x4a,0x83,0xe8,0x5a,0x47,0x02,0x00,0xa8,0x01,0x01,
        0x0c,0xa5,0xa5,0xa5,0xa5,0xa5,0xa5,0xa5,0xa5,0xa5,0xa5,0xa5,
        0xa5,0x01,0x45,0xfd,0x85,0xaa,0x9d,0xd6,0x18,0xdb,0x32,0x74,
        0x8d,0x0d,0x0b,0x04,0x2d,0xe6,0xa2,0x9d,0x42,0x25,0x34,0x8b,
        0xf1,0x60,0x30,0xbf,0xb0,0x76,0x49,0x62,0x47,0x6d,0x06,0x01,
        0x02,0x03,0x02,0x13,0x02,0x23,0x02,0x40,0x02,0x56,0x02,0x08,
        0x15,0x2c,0x21,0x02,0x23,0x06,0x34,0x01,0x42,0x04,0x56,0x06,
        0x57,0x0c,0x80,0x01,0x02,0x7f,0x00,0x7f,0x01,0x7f,0x04,0x7f,
        0x00,0x7f,0x00,0x7f,0x07,0x7c,0x0a,0x6d,0x61,0x73,0x74,0x65,
        0x72,0x47,0x61,0x69,0x6e,0x0a,0x73,0x61,0x6d,0x70,0x6c,0x65,
        0x52,0x61,0x74,0x65,0x0d,0x73,0x63,0x68,0x65,0x6d,0x61,0x56,
        0x65,0x72,0x73,0x69,0x6f,0x6e,0x06,0x74,0x72,0x61,0x63,0x6b,
        0x73,0x04,0x00,0x7f,0x03,0x02,0x7f,0x7f,0x03,0x04,0x03,0x01,
        0x7f,0x02,0x7c,0x85,0x01,0x34,0x14,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0xe0,0x3f,0x80,0xee,0x05,0x02,0x04,0x00,0x00,
    };

    daw::document::AutomergeDocument doc;
    if (!doc.loadFromBytes(kWebDoc, sizeof(kWebDoc))) {
        std::cout << "FAILED: load failed: " << doc.getLastError() << "\n";
        return false;
    }
    const auto& p = doc.getDocument();

    // Positive control: masterGain (f64) must survive - proves the doc
    // loaded and that only the int-typed fields are at issue.
    if (std::fabs(p.master_gain - 0.5f) > 1e-6f) {
        std::cout << "FAILED: masterGain misread (" << p.master_gain
                  << ") - the doc did not load as expected\n";
        return false;
    }
    // The bug: a JS-authored INT sampleRate must be read, not defaulted.
    if (p.sample_rate != 96000) {
        std::cout << "FAILED: sampleRate read as " << p.sample_rate
                  << " (expected 96000; a JS INT fell through to the 48000 default)\n";
        return false;
    }
    if (p.schema_version != 2) {
        std::cout << "FAILED: schemaVersion read as " << p.schema_version
                  << " (expected 2; a JS INT fell through to the default)\n";
        return false;
    }

    std::cout << "OK\n";
    return true;
}

// AUDIT-5 A2: computeStemKey serialized float params through a default
// ostringstream (6 significant figures). Two DISTINCT float values that
// agree to 6 sig-figs - a normalized 0..1 knob nudged by ~1 ULP, routine
// during a drag - collapsed to the SAME key, so a stale stem read FRESH
// and a peer without the plugin heard the wrong render (the badge lied).
// The key must distinguish any two distinct floats.
bool testStemKeyPrecision() {
    std::cout << "Test: stem key float precision... ";

    using namespace daw::document;
    const float v1 = 0.5f;
    const float v2 = std::nextafter(0.5f, 1.0f);  // distinct float, ~6e-8 away
    if (v1 == v2) {
        std::cout << "FAILED: test setup - values not distinct\n";
        return false;
    }

    auto makeTrack = [](float mix) {
        TrackDef t;
        ProcessorDef node;
        node.type = "vst3";
        node.uid = "84E8DE5F92554F5396FAE4133C935A18";
        node.params["0"] = mix;
        t.chain.push_back(node);
        return t;
    };

    const std::string ka = daw::render::computeStemKey(makeTrack(v1), 0, 48000, "ver");
    const std::string kb = daw::render::computeStemKey(makeTrack(v2), 0, 48000, "ver");
    if (ka == kb) {
        std::cout << "FAILED: two distinct float params produced the SAME stem "
                     "key (6-sig-fig serialization) - a stale stem would read fresh\n";
        return false;
    }

    std::cout << "OK\n";
    return true;
}

// AUDIT-5 A4: on reconnection the server resends the whole document and the
// engine callback used loadFromBytes (REPLACE) - clobbering an engine-authored
// stemHash the server had not yet seen (the engine is the ONLY author of that
// field, and the ONLY stage with no outbox). mergeFromBytes must preserve the
// local change AND integrate the server's. This test proves both halves: a
// replace loses the local stem, a merge keeps it.
bool testDocMergePreservesLocal() {
    std::cout << "Test: doc merge preserves local change (A4)... ";
    using namespace daw::document;

    // Common root: one track with one vst3 node.
    AutomergeDocument base;
    if (!base.create(48000)) { std::cout << "FAILED: create\n"; return false; }
    TrackDef t; t.id = "t1"; t.name = "T1"; t.gain = 1.0f;
    ProcessorDef node; node.id = "n1"; node.type = "vst3";
    node.uid = "84E8DE5F92554F5396FAE4133C935A18";
    t.chain.push_back(node);
    base.addTrack(t);
    const std::vector<uint8_t> baseBytes = base.toBytes();

    // Server doc: base + an unrelated change the engine never saw.
    AutomergeDocument server;
    server.loadFromBytes(baseBytes.data(), baseBytes.size());
    server.setMasterGain(0.3f);
    const std::vector<uint8_t> serverBytes = server.toBytes();

    auto makeEngineWithLocalStem = [&]() {
        AutomergeDocument e;
        e.loadFromBytes(baseBytes.data(), baseBytes.size());
        e.setProcessorStem("t1", "n1", "aabbccdd", "key-L", 0);
        return e;  // movable
    };
    auto hasLocalStem = [](const AutomergeDocument& d) {
        const auto p = d.getDocument();
        return !p.tracks.empty() && !p.tracks[0].chain.empty()
               && p.tracks[0].chain[0].stem_hash == "aabbccdd";
    };

    // 1) REPLACE (a plain load) LOSES the local stem - this is the bug the
    //    merge exists to fix; assert it so the test keeps its teeth.
    {
        AutomergeDocument e = makeEngineWithLocalStem();
        e.loadFromBytes(serverBytes.data(), serverBytes.size());
        if (hasLocalStem(e)) {
            std::cout << "FAILED: a plain load kept the local stem - the test "
                         "can no longer prove merge is needed\n";
            return false;
        }
    }

    // 2) MERGE preserves the local stem AND integrates the server change.
    {
        AutomergeDocument e = makeEngineWithLocalStem();
        if (!e.mergeFromBytes(serverBytes.data(), serverBytes.size())) {
            std::cout << "FAILED: merge returned false: " << e.getLastError() << "\n";
            return false;
        }
        if (!hasLocalStem(e)) {
            std::cout << "FAILED: merge lost the local stem (a REPLACE would do this)\n";
            return false;
        }
        if (std::fabs(e.getDocument().master_gain - 0.3f) > 1e-6f) {
            std::cout << "FAILED: merge did not integrate the server change\n";
            return false;
        }
    }

    std::cout << "OK\n";
    return true;
}

// AUDIT-5 A4 (1b): after a reconnection merge preserves the engine's local
// stemHash, but the server still lacks it. getChangesNotIn computes exactly
// the changes to PUSH so the preserved field reaches the server. This proves
// the changes are found AND that applying them gives the server the stem.
bool testGetChangesNotIn() {
    std::cout << "Test: getChangesNotIn (reconnect push, A4-1b)... ";
    using namespace daw::document;

    AutomergeDocument base;
    if (!base.create(48000)) { std::cout << "FAILED: create\n"; return false; }
    TrackDef t; t.id = "t1"; t.name = "T1"; t.gain = 1.0f;
    ProcessorDef n; n.id = "n1"; n.type = "vst3";
    n.uid = "84E8DE5F92554F5396FAE4133C935A18";
    t.chain.push_back(n);
    base.addTrack(t);
    const std::vector<uint8_t> baseBytes = base.toBytes();

    // Engine authored a local stem the server never saw.
    AutomergeDocument engine;
    engine.loadFromBytes(baseBytes.data(), baseBytes.size());
    engine.setProcessorStem("t1", "n1", "aabbccdd", "key-L", 0);

    // The server still only has base: what is it missing?
    auto missing = engine.getChangesNotIn(baseBytes.data(), baseBytes.size());
    if (missing.empty()) {
        std::cout << "FAILED: no missing changes reported - the server would "
                     "never receive the engine's stem\n";
        return false;
    }

    // Applying the pushed changes onto the server doc must surface the stem.
    AutomergeDocument server;
    server.loadFromBytes(baseBytes.data(), baseBytes.size());
    for (const auto& ch : missing) {
        if (!server.applyChange(ch.data(), ch.size())) {
            std::cout << "FAILED: server rejected a pushed change: "
                      << server.getLastError() << "\n";
            return false;
        }
    }
    const auto p = server.getDocument();
    const bool got = !p.tracks.empty() && !p.tracks[0].chain.empty()
                     && p.tracks[0].chain[0].stem_hash == "aabbccdd";
    if (!got) {
        std::cout << "FAILED: server still lacks the stem after applying pushes\n";
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
    // 2026-08-23 (V1.6): reference recomputed - the implicit 4 ms anti-click
    // fade now shapes every clip edge (deliberate rendering change, see
    // docs/DECISIONS.md). Previous reference: 89f1a1105dc09e92.
    const std::string expected_hash = "56729beb61993cd7";
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
// Test: SHA-256 (2.3a) against the FIPS 180-4 vectors - including the
// million-'a' vector that exercises multi-block streaming - and the
// asset-loading contract: AssetCache hashes file CONTENTS with it, so
// assetHash finally IS what SCHEMA.md always claimed.
bool testSha256AssetHash() {
    std::cout << "Test: SHA-256 asset hash... ";

    if (daw::util::sha256Hex("abc", 3) !=
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") {
        std::cout << "FAILED: FIPS vector 'abc'\n";
        return false;
    }
    if (daw::util::sha256Hex("", 0) !=
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") {
        std::cout << "FAILED: FIPS vector empty\n";
        return false;
    }
    {
        const std::string million(1000000, 'a');
        if (daw::util::sha256Hex(million.data(), million.size()) !=
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0") {
            std::cout << "FAILED: FIPS vector 1M x 'a' (streaming)\n";
            return false;
        }
    }

    // File hashing == buffer hashing, and the asset pipeline uses it
    const fs::path dir = fs::temp_directory_path() / "daw-sha-test";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir);
    const std::string wav_path = (dir / "tone.wav").string();
    std::vector<int16_t> samples(1024 * 2, 1234);
    if (!writeWav16(wav_path, 2, 48000, samples)) {
        std::cout << "FAILED: cannot write wav\n";
        return false;
    }
    std::ifstream f(wav_path, std::ios::binary);
    const std::vector<char> bytes((std::istreambuf_iterator<char>(f)),
                                  std::istreambuf_iterator<char>());
    const std::string from_file = daw::util::sha256HexFile(wav_path);
    if (from_file.size() != 64 ||
        from_file != daw::util::sha256Hex(bytes.data(), bytes.size())) {
        std::cout << "FAILED: file hash != buffer hash\n";
        return false;
    }
    daw::graph::AssetCache cache;
    const auto* asset = cache.loadOrGet(wav_path);
    if (!asset || asset->hash != from_file) {
        std::cout << "FAILED: AssetCache hash is not the file's SHA-256\n";
        return false;
    }

    fs::remove_all(dir, ec);
    std::cout << "OK (FIPS vectors incl. 1M streaming; AssetCache = SHA-256 of contents)\n";
    return true;
}

// Test 19 (c-2, M3): the chain round-trips through the document. A vst3
// node (uid + params as {key,value} pairs) and a builtin.gain node written
// via addTrack come back IDENTICAL through serialize/load - the document
// layer carries processors, end of the "declared but never written" era.
bool testDocumentChainRoundTrip() {
    std::cout << "Test: Document chain round-trip... ";

    daw::document::AutomergeDocument doc1;
    if (!doc1.create(48000)) {
        std::cout << "FAILED: create\n";
        return false;
    }

    daw::document::TrackDef track;
    track.id = "t1";
    track.name = "chain";
    track.gain = 1.0f;

    daw::document::ProcessorDef p1;
    p1.id = "p1";
    p1.type = "vst3";
    p1.uid = "84E8DE5F92554F5396FAE4133C935A18";
    p1.bypass = true;  // 2.4d: bypass is document state
    p1.params["0"] = 0.5f;
    p1.params["3"] = 0.25f;
    track.chain.push_back(p1);

    daw::document::ProcessorDef p2;
    p2.id = "p2";
    p2.type = "builtin.gain";
    p2.params["gain"] = 0.8f;
    track.chain.push_back(p2);

    if (!doc1.addTrack(track)) {
        std::cout << "FAILED: addTrack: " << doc1.getLastError() << "\n";
        return false;
    }

    const std::vector<uint8_t> bytes = doc1.toBytes();
    daw::document::AutomergeDocument doc2;
    if (bytes.empty() || !doc2.loadFromBytes(bytes.data(), bytes.size())) {
        std::cout << "FAILED: serialize/load\n";
        return false;
    }

    const auto& project = doc2.getDocument();
    if (project.tracks.size() != 1 || project.tracks[0].chain.size() != 2) {
        std::cout << "FAILED: expected 1 track / 2 chain nodes\n";
        return false;
    }
    const auto& r1 = project.tracks[0].chain[0];
    const auto& r2 = project.tracks[0].chain[1];
    if (r1.id != p1.id || r1.type != p1.type || r1.uid != p1.uid ||
        r1.bypass != true || r1.params != p1.params) {
        std::cout << "FAILED: vst3 node did not round-trip\n";
        return false;
    }
    if (r2.id != p2.id || r2.type != p2.type || !r2.uid.empty() ||
        r2.bypass != false || r2.params != p2.params) {
        std::cout << "FAILED: builtin.gain node did not round-trip\n";
        return false;
    }

    std::cout << "OK (vst3 uid+params+bypass and builtin.gain both identical after reload)\n";
    return true;
}

#ifdef DAW_PLUGIN_HOST_EXE
#include "host_messages.pb.h"

#ifdef _WIN32
#define DAW_POPEN _popen
#define DAW_PCLOSE _pclose
static const char* kPopenMode = "rb";
#else
#define DAW_POPEN popen
#define DAW_PCLOSE pclose
static const char* kPopenMode = "r";
#include <sys/wait.h>
#endif

// PORTABLE EXIT CODE family utility: on POSIX, pclose() returns the raw
// wait STATUS (exit 1 -> 256), not the exit code. Every Windows-hardwired
// assumption of this harness goes through a named utility like this one,
// never through an inline assumption.
static int normalizeExitCode(int raw) {
#ifdef _WIN32
    return raw;
#else
    if (WIFEXITED(raw)) return WEXITSTATUS(raw);
    return raw == 0 ? 0 : -1;  // killed by signal etc.
#endif
}

namespace {

// Run a plugin_host command line; returns exit code, fills the parsed
// response (length-prefixed HostResponse on stdout)
int runHostCommand(std::string cmd, daw::host::HostResponse& resp, bool& parsed) {
    parsed = false;
#ifdef _WIN32
    // _popen goes through `cmd /c`, which strips the OUTER quote pair when
    // the command starts with a quoted path: wrap the whole thing once more
    cmd = "\"" + cmd + "\"";
#endif
    FILE* pipe = DAW_POPEN(cmd.c_str(), kPopenMode);
    if (!pipe) return -1;

    std::string out;
    char buf[4096];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), pipe)) > 0) {
        out.append(buf, n);
    }
    const int exit_code = normalizeExitCode(DAW_PCLOSE(pipe));

    if (out.size() >= 4) {
        const uint32_t len = (static_cast<uint8_t>(out[0]) << 24) |
                             (static_cast<uint8_t>(out[1]) << 16) |
                             (static_cast<uint8_t>(out[2]) << 8) |
                             static_cast<uint8_t>(out[3]);
        if (out.size() >= 4 + len) {
            parsed = resp.ParseFromArray(out.data() + 4, static_cast<int>(len));
        }
    }
    return exit_code;
}

static std::string fixtureModulePath();

int runPluginHost(const std::string& module_path, daw::host::HostResponse& resp, bool& parsed) {
    return runHostCommand(
        std::string("\"") + DAW_PLUGIN_HOST_EXE + "\" --enumerate \"" + module_path + "\"",
        resp, parsed);
}

int runPluginHostProcess(const std::string& uid, const std::string& in_wav,
                         const std::string& out_wav, const std::string& param,
                         daw::host::HostResponse& resp, bool& parsed) {
    std::string cmd = std::string("\"") + DAW_PLUGIN_HOST_EXE + "\" --process \"" +
                      fixtureModulePath() + "\" --uid " + uid + " --in \"" + in_wav +
                      "\" --out \"" + out_wav + "\"";
    if (!param.empty()) {
        cmd += " --param " + param;
    }
    return runHostCommand(cmd, resp, parsed);
}

// PORTABLE FIXTURE PATH family utility: on Windows, $<TARGET_FILE:again>
// is the single module file named again.vst3; on Linux it is the .so
// INSIDE the bundle (.../again.vst3/Contents/x86_64-linux/again.so) and
// the SDK's module loader wants the BUNDLE root. Walk up to it.
// ONE convention on both OSes: the BUNDLE ROOT DIRECTORY (<name>.vst3/).
// $<TARGET_FILE:...> is the module file INSIDE the bundle (which can
// itself be named .vst3 on Windows): walk up to the ancestor DIRECTORY
// ending in .vst3 - Linux requires it, Windows accepts it.
static std::string bundleRootOf(const char* target_file) {
    const fs::path p = target_file;
    for (fs::path q = p.parent_path(); !q.empty() && q != q.root_path(); q = q.parent_path()) {
        if (q.extension() == ".vst3" && fs::is_directory(q)) return q.string();
    }
    return p.string();
}

static std::string fixtureModulePath() { return bundleRootOf(DAW_AGAIN_VST3); }
static std::string mdaModulePath() { return bundleRootOf(DAW_MDA_VST3); }

// AGain sample constants (stable per SDK release, verified by test 11)
constexpr const char* kAGainAudioUid = "84E8DE5F92554F5396FAE4133C935A18";
constexpr const char* kAGainControllerUid = "D39D5B65D7AF42FA843F4AC841EB04F0";
constexpr int kAGainGainParamId = 0;  // kGainId in the AGain sample

}  // namespace

// Test 11: plugin_host enumerates AGain (2.4a positive path)
bool testPluginHostEnumeration() {
    std::cout << "Test: Plugin host enumeration... ";

    daw::host::HostResponse resp;
    bool parsed = false;
    const int code = runPluginHost(fixtureModulePath(), resp, parsed);

    if (code != 0) {
        std::cout << "FAILED: exit code " << code << "\n";
        return false;
    }
    if (!parsed || !resp.has_enumerate() || !resp.enumerate().ok()) {
        std::cout << "FAILED: no valid ok-response\n";
        return false;
    }

    bool found = false;
    for (const auto& c : resp.enumerate().classes()) {
        if (c.name().find("AGain") != std::string::npos &&
            c.category() == "Audio Module Class" &&
            c.class_id().size() == 32) {
            found = true;
            std::cout << "OK (" << c.name() << " uid=" << c.class_id() << ")\n";
            break;
        }
    }
    if (!found) {
        std::cout << "FAILED: AGain audio class not found among "
                  << resp.enumerate().classes_size() << " classes\n";
        return false;
    }
    return true;
}

// Test 12: a corrupt module produces a CLEAN error - never a host crash.
// This is the whole point of process isolation (2.4a negative path).
bool testPluginHostBadModule() {
    std::cout << "Test: Plugin host bad module... ";

    // A garbage file wearing a .vst3 extension
    const fs::path bad = fs::temp_directory_path() / "daw-corrupt-test.vst3";
    {
        std::ofstream f(bad, std::ios::binary);
        f << "this is not a plugin";
    }

    daw::host::HostResponse resp;
    bool parsed = false;
    const int code = runPluginHost(bad.string(), resp, parsed);
    fs::remove(bad);

    // Clean failure = exit code 1 (a crash would surface as a large/negative
    // status), with an explanatory error in the response
    if (code != 1) {
        std::cout << "FAILED: expected clean exit 1, got " << code << "\n";
        return false;
    }
    if (!parsed || !resp.has_enumerate() || resp.enumerate().ok() ||
        resp.enumerate().error().empty()) {
        std::cout << "FAILED: no clean error response\n";
        return false;
    }

    // Nonexistent path: same contract
    daw::host::HostResponse resp2;
    bool parsed2 = false;
    const int code2 = runPluginHost("Z:/does/not/exist.vst3", resp2, parsed2);
    if (code2 != 1 || !parsed2 || resp2.enumerate().ok()) {
        std::cout << "FAILED: nonexistent path not cleanly rejected (exit " << code2 << ")\n";
        return false;
    }

    std::cout << "OK (corrupt + missing modules rejected cleanly)\n";
    return true;
}
// Test 13: AGain processes a WAV; output samples scale with the gain
// parameter, delivered through IParameterChanges - the same channel the
// document's chain will drive in 2.4c. Fixed 256-frame blocks are a formal
// contract (blocks count asserted). The WAV scale is symmetric (1/32768
// both ways), so gain 1.0 is a bit-exact identity and 0.5 is exact too.
bool testPluginHostProcessGain() {
    std::cout << "Test: Plugin host gain processing... ";

    const fs::path dir = fs::temp_directory_path() / "daw-host-process-test";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir);

    // Deterministic stereo input: 4096 frames, +/-16000 sawtooth, R = -L
    std::vector<int16_t> in(4096 * 2);
    for (size_t i = 0; i < 4096; ++i) {
        const int16_t v = static_cast<int16_t>(((i * 37) % 32000) - 16000);
        in[i * 2] = v;
        in[i * 2 + 1] = static_cast<int16_t>(-v);
    }
    const std::string in_path = (dir / "in.wav").string();
    if (!writeWav16(in_path, 2, 48000, in)) {
        std::cout << "FAILED: cannot write input\n";
        return false;
    }

    auto runCase = [&](const char* out_name, double gain,
                       daw::host::HostResponse& resp) -> bool {
        bool parsed = false;
        const std::string param = std::to_string(kAGainGainParamId) + ":" +
                                  (gain == 1.0 ? std::string("1.0") : std::string("0.5"));
        const int code = runPluginHostProcess(kAGainAudioUid, in_path,
                                              (dir / out_name).string(), param,
                                              resp, parsed);
        return code == 0 && parsed && resp.has_process() && resp.process().ok();
    };

    daw::host::HostResponse r1, r05;
    if (!runCase("out1.wav", 1.0, r1)) {
        std::cout << "FAILED: gain=1.0 run failed ("
                  << (r1.has_process() ? r1.process().error() : "no response") << ")\n";
        return false;
    }
    if (!runCase("out05.wav", 0.5, r05)) {
        std::cout << "FAILED: gain=0.5 run failed\n";
        return false;
    }

    // The block contract: 4096 frames / 256 = exactly 16 process() calls
    if (r1.process().blocks() != 16 || r1.process().frames_processed() != 4096) {
        std::cout << "FAILED: block contract broken (blocks="
                  << r1.process().blocks() << ")\n";
        return false;
    }

    const auto in_f = readWavSamples(in_path);
    const auto out1 = readWavSamples((dir / "out1.wav").string());
    const auto out05 = readWavSamples((dir / "out05.wav").string());
    if (out1.size() != in_f.size() || out05.size() != in_f.size() || in_f.empty()) {
        std::cout << "FAILED: size mismatch\n";
        return false;
    }

    // Steady-state comparison from frame 256 (sample 512): if AGain ever
    // ramps the gain, it may only affect the first block. (Current AGain
    // applies the block's last point directly - no ramp observed.)
    for (size_t i = 512; i < in_f.size(); ++i) {
        if (out1[i] != in_f[i]) {
            std::cout << "FAILED: gain=1.0 not identity at sample " << i
                      << " (" << out1[i] << " vs " << in_f[i] << ")\n";
            return false;
        }
        const float expected =
            static_cast<float>(static_cast<int16_t>(in_f[i] * 0.5f * 32768.0f)) / 32768.0f;
        if (out05[i] != expected) {
            std::cout << "FAILED: gain=0.5 mismatch at sample " << i
                      << " (" << out05[i] << " vs " << expected << ")\n";
            return false;
        }
    }

    // And the input was not silence
    float peak = 0.0f;
    for (const float s : in_f) peak = (std::max)(peak, std::fabs(s));
    if (peak < 0.4f) {
        std::cout << "FAILED: input fixture near-silent\n";
        return false;
    }

    fs::remove_all(dir, ec);
    std::cout << "OK (identity at 1.0, exact halving at 0.5, 16 blocks)\n";
    return true;
}

// Test 14: the ceremony refuses cleanly. A controller class is not an
// audio component; an unknown uid is not instantiable - both must produce
// a clean error response and exit 1, never a crash.
bool testPluginHostSetupRefusal() {
    std::cout << "Test: Plugin host setup refusal... ";

    const fs::path dir = fs::temp_directory_path() / "daw-host-refusal-test";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir);

    std::vector<int16_t> in(512 * 2, 1000);
    const std::string in_path = (dir / "in.wav").string();
    writeWav16(in_path, 2, 48000, in);

    daw::host::HostResponse resp;
    bool parsed = false;
    int code = runPluginHostProcess(kAGainControllerUid, in_path,
                                    (dir / "out.wav").string(), "0:1.0", resp, parsed);
    if (code != 1 || !parsed || !resp.has_process() || resp.process().ok() ||
        resp.process().error().empty()) {
        std::cout << "FAILED: controller class not cleanly refused (exit " << code << ")\n";
        return false;
    }

    daw::host::HostResponse resp2;
    bool parsed2 = false;
    code = runPluginHostProcess("00000000000000000000000000000000", in_path,
                                (dir / "out.wav").string(), "0:1.0", resp2, parsed2);
    if (code != 1 || !parsed2 || resp2.process().ok()) {
        std::cout << "FAILED: unknown uid not cleanly refused (exit " << code << ")\n";
        return false;
    }

    fs::remove_all(dir, ec);
    std::cout << "OK (controller class + unknown uid refused cleanly)\n";
    return true;
}

// Test 15 (2.4c-1): the bridge is TRANSPARENT. The 2.4b fixture, replayed
// CONTINUOUSLY (3 consecutive passes through ONE persistent --serve child)
// block by block across the shared segment, equals the proven --process
// offline render sample for sample. Ready ceremony (heartbeat), the param
// channel and clean shutdown are exercised on the way. Sync path only -
// the one-frame audio-callback pipeline is proven by the ProxyNode tests.
/**
 * 2.5-etat: plugin state crosses the process boundary and SURVIVES it.
 * Bridge A: param 0.25 through the ring, one processed block (the param
 * reaches the plugin), saveState -> blob. Bridge B (fresh child, fresh
 * segment, NO param ever sent): setPendingState(blob) -> the ceremony
 * restores it processor-first -> a processed block comes out at
 * EXACTLY 0.25x. The gain can only have come from the state file.
 */
bool testPluginStateRoundtrip() {
    std::cout << "Test: plugin state roundtrip (2.5-etat)... ";

    daw::host::PluginBridge a;
    if (!a.start(DAW_PLUGIN_HOST_EXE, fixtureModulePath(), kAGainAudioUid, 48000)) {
        std::cout << "FAILED: bridge A start: " << a.error() << "\n";
        return false;
    }
    a.setParam(kAGainGainParamId, 0.25);

    constexpr uint32_t kBlock = daw::host::kRingBlockSize;
    std::vector<float> in_l(kBlock, 0.5f), in_r(kBlock, -0.5f);
    std::vector<float> out_l(kBlock), out_r(kBlock);
    if (!a.processBlockSync(in_l.data(), in_r.data(),
                            out_l.data(), out_r.data(), kBlock)) {
        std::cout << "FAILED: bridge A process: " << a.error() << "\n";
        return false;
    }

    std::vector<uint8_t> blob;
    if (!a.saveState(blob) || blob.empty()) {
        std::cout << "FAILED: saveState: " << a.error()
                  << " (" << blob.size() << " bytes)\n";
        return false;
    }
    a.stop();

    daw::host::PluginBridge b;
    b.setPendingState(blob);
    if (!b.start(DAW_PLUGIN_HOST_EXE, fixtureModulePath(), kAGainAudioUid, 48000)) {
        std::cout << "FAILED: bridge B start: " << b.error() << "\n";
        return false;
    }
    // NO setParam here - the 0.25 can only come from the restored state
    if (!b.processBlockSync(in_l.data(), in_r.data(),
                            out_l.data(), out_r.data(), kBlock)) {
        std::cout << "FAILED: bridge B process: " << b.error() << "\n";
        return false;
    }
    for (uint32_t i = 0; i < kBlock; ++i) {
        if (out_l[i] != 0.5f * 0.25f || out_r[i] != -0.5f * 0.25f) {
            std::cout << "FAILED: restored gain not applied at frame " << i
                      << " (out_l=" << out_l[i] << ", expected " << 0.5f * 0.25f
                      << ")\n";
            b.stop();
            return false;
        }
    }

    // Stability: the state B saves matches the blob it was born from
    std::vector<uint8_t> blob2;
    if (!b.saveState(blob2)) {
        std::cout << "FAILED: bridge B saveState: " << b.error() << "\n";
        b.stop();
        return false;
    }
    b.stop();
    if (blob2 != blob) {
        std::cout << "FAILED: state not stable across a life ("
                  << blob.size() << " vs " << blob2.size() << " bytes)\n";
        return false;
    }

    std::cout << "OK (" << blob.size()
              << " bytes, exact 0.25x from state alone, stable)\n";
    return true;
}

/**
 * S7 - THE INVARIANT: a machine WITHOUT the plugin hears the plugin's
 * result, proven BY SAMPLES through the store.
 * Machine A (has AGain): renders the reference AND publishes the stem
 * (float32 = lossless truth). Machine B (NO module mapping at all):
 * renders the same document - the stem substitutes - and produces the
 * BYTE-IDENTICAL 16-bit WAV.
 */
/**
 * THE FIRST LESS-KIND PLUGIN (external review: every contact with the
 * real is worth ten sessions of building). mda Overdrive: REAL DSP
 * (non-linear), MULTIPLE params - the exact shape that broke the old
 * single-slot param channel (a rebuild burst kept only the last one).
 * Proves, against a real plugin:
 * 1. The v5 param FIFO delivers a BURST whole: a burst-configured
 *    child and a one-param-per-block child save the SAME state.
 * 2. Block-wise render determinism (two renders, identical bytes).
 * 3. The full stem invariant: a machine without mda renders the
 *    byte-identical WAV from the stem.
 */
bool testRealPluginMda() {
    std::cout << "Test: real plugin mda (param burst, stem)... ";
    const char* kOverdriveUid = "5653546D64614F6D6461206F76657264";

    // 1. Burst vs slow: same resulting STATE
    daw::host::PluginBridge burst;
    if (!burst.start(DAW_PLUGIN_HOST_EXE, mdaModulePath(), kOverdriveUid, 48000)) {
        std::cout << "FAILED: mda bridge start: " << burst.error() << "\n";
        return false;
    }
    constexpr uint32_t kBlock = daw::host::kRingBlockSize;
    std::vector<float> in_l(kBlock, 0.25f), in_r(kBlock, 0.25f);
    std::vector<float> out_l(kBlock), out_r(kBlock);
    // Overdrive params: 0=drive, 1=muffle, 2=output - a burst of three
    burst.setParam(0, 0.9);
    burst.setParam(1, 0.3);
    burst.setParam(2, 0.7);
    if (!burst.processBlockSync(in_l.data(), in_r.data(),
                                out_l.data(), out_r.data(), kBlock)) {
        std::cout << "FAILED: burst process: " << burst.error() << "\n";
        return false;
    }
    std::vector<uint8_t> burst_state;
    if (!burst.saveState(burst_state) || burst_state.empty()) {
        std::cout << "FAILED: burst saveState: " << burst.error() << "\n";
        return false;
    }
    burst.stop();

    daw::host::PluginBridge slow;
    if (!slow.start(DAW_PLUGIN_HOST_EXE, mdaModulePath(), kOverdriveUid, 48000)) {
        std::cout << "FAILED: slow bridge start: " << slow.error() << "\n";
        return false;
    }
    for (uint32_t id = 0; id < 3; ++id) {
        slow.setParam(id, id == 0 ? 0.9 : (id == 1 ? 0.3 : 0.7));
        if (!slow.processBlockSync(in_l.data(), in_r.data(),
                                   out_l.data(), out_r.data(), kBlock)) {
            std::cout << "FAILED: slow process " << id << "\n";
            return false;
        }
    }
    std::vector<uint8_t> slow_state;
    if (!slow.saveState(slow_state)) {
        std::cout << "FAILED: slow saveState: " << slow.error() << "\n";
        return false;
    }
    slow.stop();
    if (burst_state != slow_state) {
        std::cout << "FAILED: a burst of 3 params != the same 3 sent slowly ("
                  << burst_state.size() << " vs " << slow_state.size()
                  << " bytes) - the param channel still drops\n";
        return false;
    }

    // 2+3. Determinism and the stem invariant, against the real plugin
    const fs::path dir = fs::temp_directory_path() / "daw-mda-stem-test";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir);
    std::vector<int16_t> in(4096 * 2);
    for (size_t i = 0; i < 4096; ++i) {
        const int16_t v = static_cast<int16_t>((static_cast<int>(i) * 41) % 24000 - 12000);
        in[i * 2] = v;
        in[i * 2 + 1] = static_cast<int16_t>(-v);
    }
    if (!writeWav16((dir / "mdasrc.wav").string(), 2, 48000, in)) {
        std::cout << "FAILED: cannot write asset\n";
        return false;
    }
    daw::document::AutomergeDocument doc;
    if (!doc.create(48000)) {
        std::cout << "FAILED: doc create\n";
        return false;
    }
    daw::document::TrackDef track;
    track.id = "t1";
    track.name = "mda track";
    daw::document::ClipDef clip;
    clip.id = "c1";
    clip.asset_hash = "mdasrc";
    clip.start_sample = 0;
    clip.length_samples = 4096;
    track.clips.push_back(clip);
    daw::document::ProcessorDef proc;
    proc.id = "p1";
    proc.type = "vst3";
    proc.uid = kOverdriveUid;
    proc.params["0"] = 0.8f;
    proc.params["1"] = 0.2f;
    proc.params["2"] = 0.6f;
    track.chain.push_back(proc);
    if (!doc.addTrack(track)) {
        std::cout << "FAILED: addTrack\n";
        return false;
    }

    const std::map<std::string, std::string> modules{{kOverdriveUid, mdaModulePath()}};
    daw::render::RenderConfig config;
    config.sample_rate = 48000;
    config.bit_depth = 16;

    daw::render::OfflineRenderer withPlugin;
    withPlugin.setVst3Modules(modules, DAW_PLUGIN_HOST_EXE);
    auto r1 = withPlugin.render(doc, (dir / "r1.wav").string(), dir.string(), config);
    daw::render::OfflineRenderer withPlugin2;
    withPlugin2.setVst3Modules(modules, DAW_PLUGIN_HOST_EXE);
    auto r2 = withPlugin2.render(doc, (dir / "r2.wav").string(), dir.string(), config);
    if (!r1.success || !r2.success) {
        std::cout << "FAILED: mda render: " << r1.error << " / " << r2.error << "\n";
        return false;
    }
    // THE THIRD-PARTY REALITY, met on day one: mda Overdrive never
    // initializes filt1/filt2 (a Steinberg SAMPLE bug) - every spawn
    // starts from random heap and converges within ~100 samples. So
    // NO bit-equality across spawns (exactly why the stem key is an
    // input-cache key, never a bit-exactness promise). Asserted
    // honestly: the BODY (past a bounded transient) is identical.
    const auto f1 = readWavSamples((dir / "r1.wav").string());
    const auto f2 = readWavSamples((dir / "r2.wav").string());
    const size_t kTransient = 512 * 2;  // frames*channels
    if (f1.empty() || f1.size() != f2.size() || f1.size() <= kTransient) {
        std::cout << "FAILED: mda render sizes " << f1.size() << "/"
                  << f2.size() << "\n";
        return false;
    }
    for (size_t i = kTransient; i < f1.size(); ++i) {
        if (f1[i] != f2[i]) {
            std::cout << "FAILED: mda renders differ PAST the transient at "
                      << i << " (" << f1[i] << " vs " << f2[i] << ")\n";
            return false;
        }
    }
    if (r1.peak_left <= 0.05) {
        std::cout << "FAILED: near-silent mda render proves nothing\n";
        return false;
    }

    const auto stem = daw::render::renderTrackStem(
        doc.getDocument(), "t1", "p1", dir.string(), modules, DAW_PLUGIN_HOST_EXE);
    if (!stem.success) {
        std::cout << "FAILED: mda stem render: " << stem.error << "\n";
        return false;
    }
    if (!doc.setProcessorStem("t1", "p1", stem.stem_hash, stem.stem_key,
                              stem.latency_samples)) {
        std::cout << "FAILED: setProcessorStem\n";
        return false;
    }
    daw::render::OfflineRenderer bare;
    auto sub = bare.render(doc, (dir / "sub.wav").string(), dir.string(), config);
    if (!sub.success) {
        std::cout << "FAILED: mda substituted render: " << sub.error << "\n";
        return false;
    }
    // The stem IS the reading truth: the plugin-less machine must
    // reproduce THE STEM exactly (not the producer's random transient
    // of another spawn). Expected = the stem's own float samples
    // through the same 16-bit write/read pipeline.
    const auto fs_ = readWavSamples((dir / "sub.wav").string());
    // The stem is FLOAT32: read it through the REAL reader (ClipPlayer's
    // dr_wav road - the exact same one the substitution plays through)
    const auto stem_asset = daw::graph::ClipPlayer::loadWav(
        (dir / (stem.stem_hash + ".wav")).string());
    if (!stem_asset.isValid() ||
        fs_.size() != stem_asset.frame_count * 2 || fs_.empty()) {
        std::cout << "FAILED: substituted size " << fs_.size() << " vs stem "
                  << stem_asset.frame_count * 2 << "\n";
        return false;
    }
    for (size_t i = 0; i < fs_.size(); ++i) {
        float s = stem_asset.samples[i];
        if (s > 1.0f) s = 1.0f;
        if (s < -1.0f) s = -1.0f;
        const int16_t written = static_cast<int16_t>(s * 32767.0f);
        const float expected = static_cast<float>(written) / 32768.0f;
        if (fs_[i] != expected) {
            std::cout << "FAILED: substituted output != the stem at " << i
                      << " (" << fs_[i] << " vs " << expected << ")\n";
            return false;
        }
    }

    fs::remove_all(dir, ec);
    std::cout << "OK (burst==slow state " << burst_state.size()
              << " bytes, body deterministic past transient, substituted"
              << " == the stem exactly, peak " << r1.peak_left << ")\n";
    return true;
}

bool testStemInvariant() {
    std::cout << "Test: STEM invariant S7 (peer without plugin)... ";

    const fs::path dir = fs::temp_directory_path() / "daw-stem-s7-test";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir);

    // Deterministic source clip
    std::vector<int16_t> in(4096 * 2);
    for (size_t i = 0; i < 4096; ++i) {
        const int16_t v = static_cast<int16_t>((static_cast<int>(i) * 53) % 30000 - 15000);
        in[i * 2] = v;
        in[i * 2 + 1] = static_cast<int16_t>(-v);
    }
    if (!writeWav16((dir / "stemsrc.wav").string(), 2, 48000, in)) {
        std::cout << "FAILED: cannot write asset\n";
        return false;
    }

    daw::document::AutomergeDocument doc;
    if (!doc.create(48000)) {
        std::cout << "FAILED: doc create\n";
        return false;
    }
    daw::document::TrackDef track;
    track.id = "t1";
    track.name = "stem track";
    track.gain = 0.8f;  // stays LIVE outside the stem
    daw::document::ClipDef clip;
    clip.id = "c1";
    clip.asset_hash = "stemsrc";
    clip.start_sample = 0;
    clip.length_samples = 4096;
    track.clips.push_back(clip);
    daw::document::ProcessorDef proc;
    proc.id = "p1";
    proc.type = "vst3";
    proc.uid = kAGainAudioUid;
    proc.params["0"] = 0.5f;
    track.chain.push_back(proc);
    if (!doc.addTrack(track)) {
        std::cout << "FAILED: addTrack\n";
        return false;
    }

    const std::map<std::string, std::string> modules{
        {kAGainAudioUid, fixtureModulePath()}};
    daw::render::RenderConfig config;
    config.sample_rate = 48000;
    config.bit_depth = 16;

    // COUNTER-CONTROL 1 (the test must FAIL when the mechanism is
    // removed): BEFORE any stem exists, machine B must REFUSE this
    // document loudly - if it could produce a green here, the
    // byte-identical assertion below would prove nothing.
    {
        daw::render::OfflineRenderer bare0;
        auto refuse = bare0.render(doc, (dir / "refuse.wav").string(),
                                   dir.string(), config);
        if (refuse.success ||
            refuse.error.find("Chain incomplete") == std::string::npos) {
            std::cout << "FAILED: no-stem render did not refuse loudly ("
                      << refuse.error << ")\n";
            return false;
        }
    }

    // MACHINE A: reference render WITH the plugin
    daw::render::OfflineRenderer withPlugin;
    withPlugin.setVst3Modules(modules, DAW_PLUGIN_HOST_EXE);
    const std::string ref_path = (dir / "ref.wav").string();
    auto ref = withPlugin.render(doc, ref_path, dir.string(), config);
    if (!ref.success) {
        std::cout << "FAILED: reference render: " << ref.error << "\n";
        return false;
    }

    // MACHINE A: publish the stem
    const auto stem = daw::render::renderTrackStem(
        doc.getDocument(), "t1", "p1", dir.string(), modules,
        DAW_PLUGIN_HOST_EXE);
    if (!stem.success || stem.stem_hash.empty() || stem.stem_key.empty()) {
        std::cout << "FAILED: stem render: " << stem.error << "\n";
        return false;
    }
    if (!doc.setProcessorStem("t1", "p1", stem.stem_hash, stem.stem_key,
                              stem.latency_samples)) {
        std::cout << "FAILED: setProcessorStem\n";
        return false;
    }

    // MACHINE B: NO module mapping at all - the bare renderer that
    // refused this document before S7 now plays the stem
    daw::render::OfflineRenderer bare;
    const std::string sub_path = (dir / "sub.wav").string();
    auto subr = bare.render(doc, sub_path, dir.string(), config);
    if (!subr.success) {
        std::cout << "FAILED: substituted render: " << subr.error << "\n";
        return false;
    }

    const auto ref_f = readWavSamples(ref_path);
    const auto sub_f = readWavSamples(sub_path);
    if (ref_f.empty() || ref_f.size() != sub_f.size()) {
        std::cout << "FAILED: size mismatch " << ref_f.size() << " vs "
                  << sub_f.size() << "\n";
        return false;
    }
    for (size_t i = 0; i < ref_f.size(); ++i) {
        if (ref_f[i] != sub_f[i]) {
            std::cout << "FAILED: sample " << i << " differs: " << ref_f[i]
                      << " vs " << sub_f[i] << "\n";
            return false;
        }
    }
    if (ref.peak_left <= 0.05) {
        std::cout << "FAILED: near-silent proof proves nothing\n";
        return false;
    }

    // COUNTER-CONTROL 2: a CORRUPTED stem must refuse loudly, never a
    // false green (the substitution declines an unloadable WAV and the
    // R5 completeness guard fails the render). A mismatched KEY, by
    // contrast, still PLAYS by arbitrated design (stale stem = UI
    // state, never a playback block - reviewer amendment 2026-08-23).
    {
        const fs::path stem_file = dir / (stem.stem_hash + ".wav");
        std::vector<char> original;
        {
            std::ifstream f(stem_file, std::ios::binary);
            original.assign(std::istreambuf_iterator<char>(f),
                            std::istreambuf_iterator<char>());
        }
        {
            std::ofstream f(stem_file, std::ios::binary | std::ios::trunc);
            f << "not a wav at all";
        }
        daw::render::OfflineRenderer bareCorrupt;  // fresh asset cache
        auto corrupt = bareCorrupt.render(doc, (dir / "corrupt.wav").string(),
                                          dir.string(), config);
        if (corrupt.success) {
            std::cout << "FAILED: corrupted stem produced a green render\n";
            return false;
        }
        {
            std::ofstream f(stem_file, std::ios::binary | std::ios::trunc);
            f.write(original.data(),
                    static_cast<std::streamsize>(original.size()));
        }
    }

    // Freshness: touching a param must stale the key; a different
    // MODULE BUILD must stale it too (the multi-machine trap: two
    // builds of one plugin under one key would be indetectable)
    const std::string vtag = daw::render::moduleVersionTag(fixtureModulePath());
    if (vtag.empty()) {
        std::cout << "FAILED: module version tag empty for a readable module\n";
        return false;
    }
    const auto snap = doc.getDocument();
    auto changed = snap.tracks[0];
    changed.chain[0].params["0"] = 0.7f;
    if (daw::render::computeStemKey(changed, 0, 48000, vtag) == stem.stem_key) {
        std::cout << "FAILED: key blind to a param change\n";
        return false;
    }
    if (daw::render::computeStemKey(snap.tracks[0], 0, 48000, "other-build") ==
        stem.stem_key) {
        std::cout << "FAILED: key blind to a module version change\n";
        return false;
    }

    // PDC reader: a stem republished with a DECLARED latency plays
    // ADVANCED by that amount - sub2[i] must equal ref[i + L]
    {
        const int64_t L = 256;
        if (!doc.setProcessorStem("t1", "p1", stem.stem_hash, stem.stem_key, L)) {
            std::cout << "FAILED: setProcessorStem (latency)\n";
            return false;
        }
        daw::render::OfflineRenderer bareLat;
        const std::string lat_path = (dir / "lat.wav").string();
        auto latr = bareLat.render(doc, lat_path, dir.string(), config);
        if (!latr.success) {
            std::cout << "FAILED: latency render: " << latr.error << "\n";
            return false;
        }
        // The render length follows the DOCUMENT's clips (4096), not
        // the shortened stem: the advanced stem plays ref[i+L] for the
        // first frames-L frames, then exhausts into SILENCE.
        const auto lat_f = readWavSamples(lat_path);
        const size_t frames = lat_f.size() / 2;
        if (frames != ref_f.size() / 2 || frames <= static_cast<size_t>(L)) {
            std::cout << "FAILED: latency render length " << frames << "\n";
            return false;
        }
        const size_t body = (frames - static_cast<size_t>(L)) * 2;
        for (size_t i = 0; i < body; ++i) {
            const size_t shifted = i + static_cast<size_t>(L) * 2;
            if (lat_f[i] != ref_f[shifted]) {
                std::cout << "FAILED: PDC misaligned at sample " << i << "\n";
                return false;
            }
        }
        for (size_t i = body; i < frames * 2; ++i) {
            if (lat_f[i] != 0.0f) {
                std::cout << "FAILED: PDC tail not silent at " << i << "\n";
                return false;
            }
        }
    }

    fs::remove_all(dir, ec);
    std::cout << "OK (no-stem refused, byte-identical without the plugin, peak "
              << ref.peak_left
              << ", corrupted stem refused, key stales on param change)\n";
    return true;
}

bool testPluginBridgeTransparency() {
    std::cout << "Test: Plugin bridge transparency... ";

    const fs::path dir = fs::temp_directory_path() / "daw-bridge-test";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir);

    // Same deterministic fixture as test 13 (saw, R = -L)
    std::vector<int16_t> in(4096 * 2);
    for (size_t i = 0; i < 4096; ++i) {
        const int16_t v = static_cast<int16_t>(((i * 37) % 32000) - 16000);
        in[i * 2] = v;
        in[i * 2 + 1] = static_cast<int16_t>(-v);
    }
    const std::string in_path = (dir / "in.wav").string();
    if (!writeWav16(in_path, 2, 48000, in)) {
        std::cout << "FAILED: cannot write input\n";
        return false;
    }

    // Reference: the proven 2.4b offline path, gain 0.5
    daw::host::HostResponse ref_resp;
    bool parsed = false;
    if (runPluginHostProcess(kAGainAudioUid, in_path, (dir / "ref.wav").string(),
                             "0:0.5", ref_resp, parsed) != 0) {
        std::cout << "FAILED: reference --process run failed\n";
        return false;
    }
    const auto ref = readWavSamples((dir / "ref.wav").string());
    const auto in_f = readWavSamples(in_path);
    if (ref.size() != in_f.size() || ref.empty()) {
        std::cout << "FAILED: reference size mismatch\n";
        return false;
    }

    daw::host::PluginBridge bridge;
    if (!bridge.start(DAW_PLUGIN_HOST_EXE, fixtureModulePath(), kAGainAudioUid, 48000)) {
        std::cout << "FAILED: bridge start: " << bridge.error() << "\n";
        return false;
    }
    bridge.setParam(kAGainGainParamId, 0.5);

    constexpr uint32_t kBlock = daw::host::kRingBlockSize;
    const size_t frames = in_f.size() / 2;  // 4096, a multiple of 256
    bool ok = true;
    for (int pass = 0; pass < 3 && ok; ++pass) {
        std::vector<float> in_l(kBlock), in_r(kBlock), out_l(kBlock), out_r(kBlock);
        size_t mismatch_at = SIZE_MAX;
        for (size_t frame = 0; frame < frames && ok; frame += kBlock) {
            for (uint32_t i = 0; i < kBlock; ++i) {
                in_l[i] = in_f[(frame + i) * 2];
                in_r[i] = in_f[(frame + i) * 2 + 1];
            }
            if (!bridge.processBlockSync(in_l.data(), in_r.data(),
                                         out_l.data(), out_r.data(), kBlock)) {
                std::cout << "FAILED: pass " << pass << " frame " << frame
                          << ": " << bridge.error() << "\n";
                ok = false;
                break;
            }
            // Same 16-bit quantization as the --process WAV path, so the
            // comparison is bit-exact against the reference file
            for (uint32_t i = 0; i < kBlock && mismatch_at == SIZE_MAX; ++i) {
                const float ql = std::clamp(out_l[i] * 32768.0f, -32768.0f, 32767.0f);
                const float qr = std::clamp(out_r[i] * 32768.0f, -32768.0f, 32767.0f);
                const float fl = static_cast<float>(static_cast<int16_t>(ql)) / 32768.0f;
                const float fr = static_cast<float>(static_cast<int16_t>(qr)) / 32768.0f;
                if (fl != ref[(frame + i) * 2] || fr != ref[(frame + i) * 2 + 1]) {
                    mismatch_at = frame + i;
                }
            }
        }
        if (ok && mismatch_at != SIZE_MAX) {
            std::cout << "FAILED: pass " << pass << " differs from offline render at frame "
                      << mismatch_at << "\n";
            ok = false;
        }
    }

    const bool alive_at_end = bridge.childAlive();
    bridge.stop();
    fs::remove_all(dir, ec);

    if (!ok) return false;
    if (!alive_at_end) {
        std::cout << "FAILED: child died during the replay\n";
        return false;
    }
    std::cout << "OK (3 continuous passes bit-equal to offline render, clean shutdown)\n";
    return true;
}

// Test 16 (2.4c-1): the ONE-FRAME PIPELINE of ProxyNode, both faces.
// (a) Ring with NO child: block 1 = silence (pipeline fill, not an
//     incident), block N = DRY block N-1 (time-aligned bypass), one missed
//     count per unserved block. Fully deterministic, no process involved.
// (b) Real child: block 1 = silence, block N = WET block N-1 (AGain at
//     0.5 through the ring param channel), zero missed. The test paces the
//     child (polls output_seq) so wet delivery is deterministic; the
//     callback never does - that is exactly what (a) covers.
bool testProxyNodePipeline() {
    std::cout << "Test: Proxy node one-frame pipeline... ";

    constexpr uint32_t kBlock = daw::host::kRingBlockSize;
    auto fillBlock = [](std::vector<float>& buf, int block) {
        for (uint32_t i = 0; i < kBlock; ++i) {
            const float v = static_cast<float>((block * 131 + static_cast<int>(i) * 37) % 32000 - 16000) / 32768.0f;
            buf[2 * i] = v;
            buf[2 * i + 1] = -v;
        }
    };

    // ---- (a) no child: dry bypass, counted --------------------------------
    {
        auto orphan = std::make_unique<daw::host::SharedAudioRing>();
        std::memset(static_cast<void*>(orphan.get()), 0, sizeof(daw::host::SharedAudioRing));
        std::atomic<uint64_t> missed{0};
        daw::host::ProxyNode node("orphan", orphan.get(), &missed);

        std::vector<float> buf(kBlock * 2), prev_in(kBlock * 2);
        for (int b = 1; b <= 4; ++b) {
            std::vector<float> cur_in(kBlock * 2);
            fillBlock(cur_in, b);
            buf = cur_in;
            node.process(buf.data(), buf.data(), kBlock, 0);  // in place, like the chain
            if (b == 1) {
                for (const float s : buf) {
                    if (s != 0.0f) {
                        std::cout << "FAILED: block 1 not silent (pipeline fill)\n";
                        return false;
                    }
                }
                if (missed.load() != 0) {
                    std::cout << "FAILED: pipeline fill counted as missed\n";
                    return false;
                }
            } else {
                if (buf != prev_in) {
                    std::cout << "FAILED: block " << b << " is not the DRY block " << (b - 1) << "\n";
                    return false;
                }
                if (missed.load() != static_cast<uint64_t>(b - 1)) {
                    std::cout << "FAILED: missed=" << missed.load() << " after block " << b << "\n";
                    return false;
                }
            }
            prev_in = cur_in;
        }
    }

    // ---- (b) real child: wet path, one block late, zero missed ------------
    daw::host::PluginBridge bridge;
    if (!bridge.start(DAW_PLUGIN_HOST_EXE, fixtureModulePath(), kAGainAudioUid, 48000)) {
        std::cout << "FAILED: bridge start: " << bridge.error() << "\n";
        return false;
    }
    bridge.setParam(kAGainGainParamId, 0.5);

    std::atomic<uint64_t> missed{0};
    daw::host::ProxyNode node("live", bridge.ring(), &missed);
    std::vector<float> buf(kBlock * 2), prev_in(kBlock * 2);
    bool ok = true;
    for (int b = 1; b <= 6 && ok; ++b) {
        std::vector<float> cur_in(kBlock * 2);
        fillBlock(cur_in, b);
        buf = cur_in;
        node.process(buf.data(), buf.data(), kBlock, 0);
        if (b == 1) {
            for (const float s : buf) {
                if (s != 0.0f) {
                    std::cout << "FAILED: live block 1 not silent\n";
                    ok = false;
                    break;
                }
            }
        } else {
            for (uint32_t i = 0; i < kBlock * 2; ++i) {
                if (buf[i] != prev_in[i] * 0.5f) {  // exact: 0.5 is a power of two
                    std::cout << "FAILED: live block " << b
                              << " not WET block " << (b - 1) << " at sample " << i
                              << " (" << buf[i] << " vs " << prev_in[i] * 0.5f << ")\n";
                    ok = false;
                    break;
                }
            }
        }
        // Pace the child: wet delivery of block b must be certain before
        // the next deposit (the callback never does this - case (a) is
        // what happens when it can't be)
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(500);
        while (bridge.ring()->output_seq.load(std::memory_order_acquire) <
                   static_cast<uint64_t>(b) &&
               std::chrono::steady_clock::now() < deadline) {
            std::this_thread::yield();
        }
        prev_in = cur_in;
    }

    const uint64_t live_missed = missed.load();
    const bool alive = bridge.childAlive();
    bridge.stop();
    if (!ok) return false;
    if (live_missed != 0) {
        std::cout << "FAILED: " << live_missed << " missed blocks with a paced child\n";
        return false;
    }
    if (!alive) {
        std::cout << "FAILED: child died during the pipeline test\n";
        return false;
    }

    // ---- (c) depth=2, deposits in BURSTS OF TWO with no pacing inside the
    // pair: the real device-callback cadence (512-frame buffer = 2 blocks
    // back-to-back). This is the exact scenario the first live run failed
    // (534/1875 dry with depth 1); with depth 2 every wanted block was
    // deposited a full device period earlier - zero missed, deterministic.
    daw::host::PluginBridge bridge2;
    if (!bridge2.start(DAW_PLUGIN_HOST_EXE, fixtureModulePath(), kAGainAudioUid, 48000)) {
        std::cout << "FAILED: bridge2 start: " << bridge2.error() << "\n";
        return false;
    }
    bridge2.setParam(kAGainGainParamId, 0.5);
    std::atomic<uint64_t> missed2{0};
    daw::host::ProxyNode node2("live-d2", bridge2.ring(), &missed2, 2);

    std::vector<std::vector<float>> history(1);  // 1-indexed by block
    ok = true;
    for (int pair = 1; pair <= 7 && ok; pair += 2) {
        for (int k = 0; k < 2 && ok; ++k) {
            const int blk = pair + k;
            std::vector<float> cur(kBlock * 2);
            fillBlock(cur, blk);
            history.push_back(cur);
            buf = cur;
            node2.process(buf.data(), buf.data(), kBlock, 0);
            if (blk <= 2) {
                for (const float s : buf) {
                    if (s != 0.0f) {
                        std::cout << "FAILED: depth-2 fill block " << blk << " not silent\n";
                        ok = false;
                        break;
                    }
                }
            } else {
                const auto& want_in = history[blk - 2];
                for (uint32_t i = 0; i < kBlock * 2; ++i) {
                    if (buf[i] != want_in[i] * 0.5f) {
                        std::cout << "FAILED: depth-2 block " << blk
                                  << " not WET block " << (blk - 2) << " at sample " << i << "\n";
                        ok = false;
                        break;
                    }
                }
            }
        }
        // Pace BETWEEN pairs only (one device period of headroom)
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(500);
        while (bridge2.ring()->output_seq.load(std::memory_order_acquire) <
                   static_cast<uint64_t>(pair + 1) &&
               std::chrono::steady_clock::now() < deadline) {
            std::this_thread::yield();
        }
    }

    const uint64_t d2_missed = missed2.load();
    const bool alive2 = bridge2.childAlive();
    bridge2.stop();
    if (!ok) return false;
    if (d2_missed != 0) {
        std::cout << "FAILED: depth-2 missed " << d2_missed << " blocks in paired bursts\n";
        return false;
    }
    if (!alive2) {
        std::cout << "FAILED: depth-2 child died\n";
        return false;
    }
    std::cout << "OK (fill=silence, dry bypass counted, wet at depth, bursts of 2 at depth 2: 0 missed)\n";
    return true;
}

// Test 17 (c-2 first gesture): the param channel applies SUCCESSIVE
// changes, each at the very next block, through the seqlock (odd/even, see
// shared_audio_ring.h). Functional proof of the hardened channel: default
// 1.0 identity, then 0.5, 0.25, back to 1.0 - all powers of two, all
// compared exactly. (The seqlock's tear-proofing itself is structural: a
// deterministic torn-pairing repro would need to freeze the writer
// mid-write; the protocol is asserted by construction and documented in
// the contract header.)
bool testParamChannelSequence() {
    std::cout << "Test: Param channel sequence... ";

    constexpr uint32_t kBlock = daw::host::kRingBlockSize;
    daw::host::PluginBridge bridge;
    if (!bridge.start(DAW_PLUGIN_HOST_EXE, fixtureModulePath(), kAGainAudioUid, 48000)) {
        std::cout << "FAILED: bridge start: " << bridge.error() << "\n";
        return false;
    }

    std::vector<float> in_l(kBlock), in_r(kBlock), out_l(kBlock), out_r(kBlock);
    for (uint32_t i = 0; i < kBlock; ++i) {
        in_l[i] = static_cast<float>((static_cast<int>(i) * 37) % 32000 - 16000) / 32768.0f;
        in_r[i] = -in_l[i];
    }

    // (gain sent before the block, expected multiplier on that block)
    const struct { double sent; float expect; bool send; } steps[] = {
        {0.0, 1.0f, false},   // nothing sent: AGain default gain = identity
        {0.5, 0.5f, true},
        {0.25, 0.25f, true},
        {1.0, 1.0f, true},
    };

    for (const auto& step : steps) {
        if (step.send) bridge.setParam(kAGainGainParamId, step.sent);
        if (!bridge.processBlockSync(in_l.data(), in_r.data(), out_l.data(),
                                     out_r.data(), kBlock)) {
            std::cout << "FAILED: block failed: " << bridge.error() << "\n";
            return false;
        }
        for (uint32_t i = 0; i < kBlock; ++i) {
            if (out_l[i] != in_l[i] * step.expect || out_r[i] != in_r[i] * step.expect) {
                std::cout << "FAILED: expected x" << step.expect << " at sample " << i
                          << " (" << out_l[i] << " vs " << in_l[i] * step.expect << ")\n";
                return false;
            }
        }
    }

    bridge.stop();
    std::cout << "OK (default identity, then 0.5 / 0.25 / 1.0 each applied next block)\n";
    return true;
}

// Test 18 (c-2): the crash. Child killed MID-FLIGHT -> the very next
// unserved block is a clean DRY bypass (exact samples, no artifact, just
// counted), childAlive() reports the death on the control side, a cold
// restart on the SAME segment brings the sound back WET - with the latest
// param re-applied from the surviving ring (the restart is cold
// plugin-side, seamless ring-side). Plus the orphan guard: a child spawned
// with a dead/unreachable --parent exits 0 on its own.
bool testChildCrashRecovery() {
    std::cout << "Test: Child crash and cold restart... ";

    constexpr uint32_t kBlock = daw::host::kRingBlockSize;
    daw::host::PluginBridge bridge;
    if (!bridge.start(DAW_PLUGIN_HOST_EXE, fixtureModulePath(), kAGainAudioUid, 48000)) {
        std::cout << "FAILED: bridge start: " << bridge.error() << "\n";
        return false;
    }
    bridge.setParam(kAGainGainParamId, 0.5);

    std::atomic<uint64_t> missed{0};
    daw::host::ProxyNode node("crash", bridge.ring(), &missed, 1);

    auto fill = [&](std::vector<float>& buf, int block) {
        for (uint32_t i = 0; i < kBlock; ++i) {
            const float v = static_cast<float>((block * 131 + static_cast<int>(i) * 37) % 32000 - 16000) / 32768.0f;
            buf[2 * i] = v;
            buf[2 * i + 1] = -v;
        }
    };
    auto paceUntil = [&](uint64_t seq) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(2000);
        while (bridge.ring()->output_seq.load(std::memory_order_acquire) < seq &&
               std::chrono::steady_clock::now() < deadline) {
            std::this_thread::yield();
        }
    };

    std::vector<float> buf(kBlock * 2), prev_in(kBlock * 2), cur_in(kBlock * 2);

    // Blocks 1-2: pipeline fill then WET at 0.5
    fill(cur_in, 1);
    buf = cur_in;
    node.process(buf.data(), buf.data(), kBlock, 0);
    paceUntil(1);
    prev_in = cur_in;
    fill(cur_in, 2);
    buf = cur_in;
    node.process(buf.data(), buf.data(), kBlock, 0);
    for (uint32_t i = 0; i < kBlock * 2; ++i) {
        if (buf[i] != prev_in[i] * 0.5f) {
            std::cout << "FAILED: pre-kill block not wet at sample " << i << "\n";
            return false;
        }
    }
    paceUntil(2);

    // THE KILL, mid-flight
    bridge.terminateChildForTest();
    if (bridge.childAlive()) {
        std::cout << "FAILED: childAlive() still true after kill\n";
        return false;
    }

    // Next block: block 3 deposits, wants block 2 - already served before
    // the kill, so still WET; block 4 wants 3, unserved -> DRY exact
    prev_in = cur_in;
    fill(cur_in, 3);
    buf = cur_in;
    node.process(buf.data(), buf.data(), kBlock, 0);
    for (uint32_t i = 0; i < kBlock * 2; ++i) {
        if (buf[i] != prev_in[i] * 0.5f) {
            std::cout << "FAILED: already-served block lost after kill at sample " << i << "\n";
            return false;
        }
    }
    const uint64_t missed_before = missed.load();
    prev_in = cur_in;
    fill(cur_in, 4);
    buf = cur_in;
    node.process(buf.data(), buf.data(), kBlock, 0);
    for (uint32_t i = 0; i < kBlock * 2; ++i) {
        if (buf[i] != prev_in[i]) {  // DRY, exact - no artifact
            std::cout << "FAILED: post-kill block not a clean dry bypass at sample " << i << "\n";
            return false;
        }
    }
    if (missed.load() != missed_before + 1) {
        std::cout << "FAILED: dead-child block not counted\n";
        return false;
    }

    // COLD RESTART on the same segment
    if (!bridge.restartChild()) {
        std::cout << "FAILED: restart: " << bridge.error() << "\n";
        return false;
    }
    if (!bridge.childAlive() || bridge.restartCount() != 1) {
        std::cout << "FAILED: restarted child not alive/counted\n";
        return false;
    }

    // The new child catches up (bounded backlog) - after pacing, the next
    // exchange is WET again at 0.5: the latest param SURVIVED the crash in
    // the ring
    paceUntil(4);
    prev_in = cur_in;
    fill(cur_in, 5);
    buf = cur_in;
    node.process(buf.data(), buf.data(), kBlock, 0);
    for (uint32_t i = 0; i < kBlock * 2; ++i) {
        if (buf[i] != prev_in[i] * 0.5f) {
            std::cout << "FAILED: post-restart block not wet at 0.5 at sample " << i
                      << " (param did not survive)\n";
            return false;
        }
    }
    bridge.stop();

    // Orphan guard: unreachable --parent => the child exits 0 by itself,
    // before even mapping anything
    daw::host::HostResponse unused;
    bool parsed = false;
    const int code = runHostCommand(
        std::string("\"") + DAW_PLUGIN_HOST_EXE +
            "\" --serve nosegment --module nomodule --uid 0 --parent 2147483647",
        unused, parsed);
    if (code != 0) {
        std::cout << "FAILED: dead-parent child did not exit cleanly (exit " << code << ")\n";
        return false;
    }

    std::cout << "OK (kill -> exact dry + counted, cold restart -> wet, param survived, orphan self-exits)\n";
    return true;
}

// Test 20 (c-2): THE SOUND COMES FROM THE DOCUMENT. A document whose chain
// carries a vst3 node (uid + params, no path - resolution is host-side) is
// rendered offline through a real out-of-process AGain, and the output
// samples are EXACTLY input x 0.5 through the full pipeline (dr_wav /32768
// load -> AGain x0.5 in float -> renderer x32767 truncating convert - the
// expectation mirrors those three sites). M3 settled, proven by samples.
bool testDocumentChainRender() {
    std::cout << "Test: Document chain drives the render... ";

    const fs::path dir = fs::temp_directory_path() / "daw-chain-render-test";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir);

    // Asset under its hash-name, deterministic content
    std::vector<int16_t> in(4096 * 2);
    for (size_t i = 0; i < 4096; ++i) {
        const int16_t v = static_cast<int16_t>((static_cast<int>(i) * 37) % 32000 - 16000);
        in[i * 2] = v;
        in[i * 2 + 1] = static_cast<int16_t>(-v);
    }
    if (!writeWav16((dir / "chainhash.wav").string(), 2, 48000, in)) {
        std::cout << "FAILED: cannot write asset\n";
        return false;
    }

    daw::document::AutomergeDocument doc;
    if (!doc.create(48000)) {
        std::cout << "FAILED: doc create\n";
        return false;
    }
    daw::document::TrackDef track;
    track.id = "t1";
    track.name = "chain track";
    track.gain = 1.0f;
    daw::document::ClipDef clip;
    clip.id = "c1";
    clip.asset_hash = "chainhash";
    clip.start_sample = 0;
    clip.length_samples = 4096;
    clip.offset_samples = 0;
    track.clips.push_back(clip);
    daw::document::ProcessorDef proc;
    proc.id = "p1";
    proc.type = "vst3";
    proc.uid = kAGainAudioUid;
    proc.params["0"] = 0.5f;  // VST3 param id 0 (AGain gain), normalized
    track.chain.push_back(proc);
    if (!doc.addTrack(track)) {
        std::cout << "FAILED: addTrack: " << doc.getLastError() << "\n";
        return false;
    }

    daw::render::OfflineRenderer renderer;
    renderer.setVst3Modules({{kAGainAudioUid, fixtureModulePath()}}, DAW_PLUGIN_HOST_EXE);
    daw::render::RenderConfig config;
    config.sample_rate = 48000;
    config.bit_depth = 16;
    const std::string out_path = (dir / "out.wav").string();
    const auto result = renderer.render(doc, out_path, dir.string(), config);
    if (!result.success) {
        std::cout << "FAILED: render: " << result.error << "\n";
        return false;
    }

    const auto out_f = readWavSamples(out_path);
    if (out_f.size() != in.size()) {
        std::cout << "FAILED: output size " << out_f.size() << " vs " << in.size() << "\n";
        return false;
    }
    // V1.6 (test updated WITH the behavior, signaled): the implicit 4 ms
    // anti-click ramp (48000/250 = 192 samples) now shapes the clip's
    // edges; expectations replicate the engine's exact float ops.
    const auto edgeRamp = [](size_t frame) {
        float g = 1.0f;
        if (frame < 192) {
            g *= static_cast<float>(frame + 1) / static_cast<float>(192);
        }
        const size_t remaining = 4096 - frame;
        if (remaining <= 192) {
            g *= static_cast<float>(remaining) / static_cast<float>(192);
        }
        return g;
    };
    for (size_t i = 0; i < in.size(); ++i) {
        const float loaded = static_cast<float>(in[i]) / 32768.0f;   // dr_wav f32
        const float ramped = loaded * edgeRamp(i / 2);               // V1.6 fade
        const float halved = ramped * 0.5f;                          // AGain
        const int16_t written = static_cast<int16_t>(halved * 32767.0f);  // convertSamples
        const float expected = static_cast<float>(written) / 32768.0f;    // readWavSamples
        if (out_f[i] != expected) {
            std::cout << "FAILED: sample " << i << " = " << out_f[i]
                      << ", expected " << expected << "\n";
            return false;
        }
    }

    // 2.4d: THE BYPASS IS HEARD. Same document with bypass=true on the
    // node -> the render is the exact IDENTITY of the input through the
    // load/convert pipeline (and no child is even spawned for it)
    daw::document::AutomergeDocument doc_byp;
    if (!doc_byp.create(48000)) {
        std::cout << "FAILED: bypass doc create\n";
        return false;
    }
    track.chain[0].bypass = true;
    if (!doc_byp.addTrack(track)) {
        std::cout << "FAILED: bypass addTrack\n";
        return false;
    }
    const std::string byp_path = (dir / "byp.wav").string();
    const auto result_byp = renderer.render(doc_byp, byp_path, dir.string(), config);
    if (!result_byp.success) {
        std::cout << "FAILED: bypass render: " << result_byp.error << "\n";
        return false;
    }
    const auto byp_f = readWavSamples(byp_path);
    if (byp_f.size() != in.size()) {
        std::cout << "FAILED: bypass output size\n";
        return false;
    }
    for (size_t i = 0; i < in.size(); ++i) {
        const float loaded = static_cast<float>(in[i]) / 32768.0f;
        const float ramped = loaded * edgeRamp(i / 2);  // V1.6: ramp survives bypass
        const int16_t written = static_cast<int16_t>(ramped * 32767.0f);
        const float expected = static_cast<float>(written) / 32768.0f;
        if (byp_f[i] != expected) {
            std::cout << "FAILED: bypass sample " << i << " = " << byp_f[i]
                      << ", expected identity " << expected << "\n";
            return false;
        }
    }

    // Control: the same render must FAIL LOUDLY when the uid cannot be
    // resolved (AUDIT R5 - never silently a different sound)
    daw::render::OfflineRenderer bare;
    track.chain[0].bypass = false;
    const auto bad = bare.render(doc, (dir / "bad.wav").string(), dir.string(), config);
    if (bad.success || bad.error.find("Chain incomplete") == std::string::npos) {
        std::cout << "FAILED: unresolved chain did not fail the render (" << bad.error << ")\n";
        return false;
    }

    fs::remove_all(dir, ec);
    std::cout << "OK (halved wet, exact identity on bypass, unresolved uid fails loudly)\n";
    return true;
}
#endif  // DAW_PLUGIN_HOST_EXE

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

// The callback's thread-local context - same extern the AudioDevice uses.
namespace daw::audio {
extern thread_local AudioCallbackContext* g_callback_context;
}

/**
 * V1.1: loop and end-of-content stop live IN THE CALLBACK (single writer
 * of position_ during playback). Three invariants:
 * (a) looping: crossing the brace wraps sample-accurately;
 * (b) no loop: transport stops with position parked EXACTLY at end;
 * (c) end <= start (empty project): neither wrap nor stop nor hang.
 */
bool testTransportLoopAndStop() {
    std::cout << "Test: transport loop and end-stop in the callback... ";
    using namespace daw::audio;

    daw::transport::TransportState transport;
    daw::graph::AudioGraph graph;  // empty graph: position semantics only
    graph.prepare(48000, INTERNAL_BLOCK_SIZE);

    std::atomic<daw::graph::AudioGraph*> graph_slot{&graph};
    std::atomic<uint64_t> generation{0};
    std::atomic<uint64_t> underruns{0};
    CommandRingBuffer commands;
    TelemetryRingBuffer telemetry;

    AudioCallbackContext ctx;
    ctx.command_buffer = &commands;
    ctx.telemetry_buffer = &telemetry;
    ctx.active_graph = &graph_slot;
    ctx.callback_generation = &generation;
    ctx.transport = &transport;
    ctx.buffer_underrun_count = &underruns;
    g_callback_context = &ctx;

    std::vector<float> out(1024 * 2, 0.0f);

    // (a) looping across the brace: 900 + 512 over end=1000
    // -> 100 to the end, wrap to 0, 412 past it. Exactly.
    transport.setLoopPoints(0, 1000);
    transport.setLooping(true);
    transport.seek(900);
    transport.play();
    audioCallback(nullptr, out.data(), nullptr, 512);
    if (transport.getPosition() != 412 || !transport.isPlaying()) {
        std::cout << "FAILED: loop wrap gave position "
                  << transport.getPosition() << " (expected 412), playing="
                  << transport.isPlaying() << "\n";
        g_callback_context = nullptr;
        return false;
    }

    // (b) no loop: stop, parked exactly at end
    transport.setLooping(false);
    transport.seek(900);
    audioCallback(nullptr, out.data(), nullptr, 512);
    if (transport.getPosition() != 1000 || transport.isPlaying()) {
        std::cout << "FAILED: end-stop gave position "
                  << transport.getPosition() << " (expected 1000), playing="
                  << transport.isPlaying() << "\n";
        g_callback_context = nullptr;
        return false;
    }

    // (c) empty content: end<=start must neither wrap, stop, nor hang
    transport.setLoopPoints(0, 0);
    transport.setLooping(true);
    transport.seek(0);
    transport.play();
    audioCallback(nullptr, out.data(), nullptr, 512);
    if (transport.getPosition() != 512 || !transport.isPlaying()) {
        std::cout << "FAILED: empty-project guard gave position "
                  << transport.getPosition() << " (expected 512), playing="
                  << transport.isPlaying() << "\n";
        g_callback_context = nullptr;
        return false;
    }

    g_callback_context = nullptr;
    std::cout << "OK\n";
    return true;
}

/**
 * V1.2: masterGain drives the render. Proof at the FLOAT stage (peaks are
 * computed before quantization): x0.5 is exact in IEEE754, so the peaks
 * must be EXACTLY halved - EXPECT equality, never toBeCloseTo (regime).
 * The default (field absent / 1.0) is covered by testRenderDeterminism:
 * its reference hash would move if the master stage changed anything.
 */
bool testMasterGainRender() {
    std::cout << "Test: masterGain halves the render exactly... ";

    const fs::path dir = fs::temp_directory_path() / "daw-master-fixture";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir);

    std::vector<int16_t> square(24000 * 2);
    for (size_t i = 0; i < 24000; ++i) {
        const int16_t v = (i % 96 < 48) ? int16_t{8192} : int16_t{-8192};
        square[i * 2] = v;
        square[i * 2 + 1] = static_cast<int16_t>(-v);
    }
    const std::string hashA = writeHashedAsset(dir, 2, square);
    if (hashA.empty()) {
        std::cout << "FAILED: could not write fixture asset\n";
        return false;
    }

    daw::document::AutomergeDocument doc;
    if (!doc.create(48000)) {
        std::cout << "FAILED: document creation failed\n";
        return false;
    }
    daw::document::TrackDef track;
    track.id = "track-1";
    track.name = "Square";
    track.gain = 1.0f;
    daw::document::ClipDef clip;
    clip.id = "clip-1";
    clip.asset_hash = hashA;
    clip.start_sample = 0;
    clip.length_samples = 24000;
    clip.offset_samples = 0;
    track.clips.push_back(clip);
    doc.addTrack(track);

    daw::render::RenderConfig config;
    config.sample_rate = 48000;
    config.bit_depth = 16;
    config.end_sample = -1;
    daw::render::OfflineRenderer renderer;

    const std::string outA = (dir / "full.wav").string();
    const std::string outB = (dir / "half.wav").string();
    auto resultA = renderer.render(doc, outA, dir.string(), config);

    if (!doc.setMasterGain(0.5f)) {
        std::cout << "FAILED: setMasterGain: " << doc.getLastError() << "\n";
        return false;
    }
    // Roundtrip: the field must come back from the document itself
    if (doc.getDocument().master_gain != 0.5f) {
        std::cout << "FAILED: masterGain roundtrip gave "
                  << doc.getDocument().master_gain << "\n";
        return false;
    }
    auto resultB = renderer.render(doc, outB, dir.string(), config);

    fs::remove(outA);
    fs::remove(outB);

    if (!resultA.success || !resultB.success) {
        std::cout << "FAILED: render failed: " << resultA.error
                  << " / " << resultB.error << "\n";
        return false;
    }
    if (resultA.peak_left <= 0.05f) {
        std::cout << "FAILED: fixture rendered (near-)silence\n";
        return false;
    }
    if (resultB.peak_left != resultA.peak_left * 0.5f ||
        resultB.peak_right != resultA.peak_right * 0.5f) {
        std::cout << "FAILED: peaks not exactly halved: "
                  << resultA.peak_left << "/" << resultA.peak_right
                  << " -> " << resultB.peak_left << "/" << resultB.peak_right << "\n";
        return false;
    }

    std::cout << "OK (peak " << resultA.peak_left << " -> "
              << resultB.peak_left << ", exact)\n";
    return true;
}

/**
 * V1.6: clip fades render as EXACT linear ramps.
 * Clip A: explicit fadeIn=100 / fadeOut=50. Clip B: fields at 0 ->
 * implicit 4 ms (192) CLAMPED to half of its 300-sample length (150).
 * Expectations replicate the engine's float ops sample by sample; the
 * document roundtrip of the two additive fields is asserted too.
 */
bool testClipFadesRender() {
    std::cout << "Test: clip fade ramps (V1.6)... ";

    const fs::path dir = fs::temp_directory_path() / "daw-fades-test";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir);

    // Constant asset: 16000/32768 is dyadic - every float op is exact
    std::vector<int16_t> in(4096 * 2, 16000);
    if (!writeWav16((dir / "fadehash.wav").string(), 2, 48000, in)) {
        std::cout << "FAILED: cannot write asset\n";
        return false;
    }

    daw::document::AutomergeDocument doc;
    if (!doc.create(48000)) {
        std::cout << "FAILED: doc create\n";
        return false;
    }
    daw::document::TrackDef track;
    track.id = "t1";
    track.name = "fades";
    track.gain = 1.0f;
    daw::document::ClipDef a;
    a.id = "a";
    a.asset_hash = "fadehash";
    a.start_sample = 0;
    a.length_samples = 1000;
    a.fade_in_samples = 100;
    a.fade_out_samples = 50;
    track.clips.push_back(a);
    daw::document::ClipDef b;
    b.id = "b";
    b.asset_hash = "fadehash";
    b.start_sample = 2000;
    b.length_samples = 300;  // < 2x192: implicit fade clamps to 150
    track.clips.push_back(b);
    if (!doc.addTrack(track)) {
        std::cout << "FAILED: addTrack: " << doc.getLastError() << "\n";
        return false;
    }

    // Roundtrip: the additive fields come back from the document
    // (getDocument returns BY VALUE - keep the copy alive)
    const auto rt_doc = doc.getDocument();
    const auto& rt = rt_doc.tracks[0];
    if (rt.clips[0].fade_in_samples != 100 || rt.clips[0].fade_out_samples != 50 ||
        rt.clips[1].fade_in_samples != 0 || rt.clips[1].fade_out_samples != 0) {
        std::cout << "FAILED: fade fields roundtrip\n";
        return false;
    }

    daw::render::OfflineRenderer renderer;
    daw::render::RenderConfig config;
    config.sample_rate = 48000;
    config.bit_depth = 16;
    const std::string out_path = (dir / "out.wav").string();
    const auto result = renderer.render(doc, out_path, dir.string(), config);
    if (!result.success) {
        std::cout << "FAILED: render: " << result.error << "\n";
        return false;
    }
    const auto out_f = readWavSamples(out_path);
    if (out_f.size() < 2300 * 2) {
        std::cout << "FAILED: output too short: " << out_f.size() << "\n";
        return false;
    }

    const float loaded = 16000.0f / 32768.0f;
    const auto expectAt = [&](int64_t frame, float gain, const char* what) {
        const float ramped = loaded * gain;
        const int16_t written = static_cast<int16_t>(ramped * 32767.0f);
        const float expected = static_cast<float>(written) / 32768.0f;
        if (out_f[frame * 2] != expected) {
            std::cout << "FAILED: " << what << " frame " << frame << " = "
                      << out_f[frame * 2] << ", expected " << expected << "\n";
            return false;
        }
        return true;
    };
    // Clip A, explicit ramps
    if (!expectAt(0, 1.0f / 100.0f, "A fade-in first")) return false;
    if (!expectAt(99, 100.0f / 100.0f, "A fade-in last")) return false;
    if (!expectAt(500, 1.0f, "A body")) return false;
    if (!expectAt(950, 50.0f / 50.0f, "A fade-out first")) return false;
    if (!expectAt(999, 1.0f / 50.0f, "A fade-out last")) return false;
    // Clip B, implicit clamped to 150
    if (!expectAt(2000, 1.0f / 150.0f, "B fade-in first")) return false;
    if (!expectAt(2149, 1.0f, "B fade-in last")) return false;
    if (!expectAt(2150, 1.0f, "B fade-out first")) return false;
    if (!expectAt(2299, 1.0f / 150.0f, "B fade-out last")) return false;
    // Between the clips: silence
    if (out_f[1500 * 2] != 0.0f) {
        std::cout << "FAILED: expected silence between clips\n";
        return false;
    }

    fs::remove_all(dir, ec);
    std::cout << "OK (explicit 100/50 exact, implicit clamped 150, roundtrip)\n";
    return true;
}

/**
 * 2.5-etat: the state reference lives in the document. The ENGINE
 * authors it (setProcessorState), it roundtrips through save/load,
 * and getLastLocalChange yields shippable bytes another document can
 * apply (the exact road to the server).
 */
bool testProcessorStateInDocument() {
    std::cout << "Test: processor state in document (2.5-etat)... ";

    daw::document::AutomergeDocument doc;
    if (!doc.create(48000)) {
        std::cout << "FAILED: create\n";
        return false;
    }
    daw::document::TrackDef track;
    track.id = "t1";
    track.name = "state track";
    daw::document::ProcessorDef proc;
    proc.id = "p1";
    proc.type = "vst3";
    proc.uid = "84E8DE5F92554F5396FAE4133C935A18";
    track.chain.push_back(proc);
    if (!doc.addTrack(track)) {
        std::cout << "FAILED: addTrack\n";
        return false;
    }

    const std::string sha(64, 'a');
    if (!doc.setProcessorState("t1", "p1", sha, 3)) {
        std::cout << "FAILED: setProcessorState: " << doc.getLastError() << "\n";
        return false;
    }
    // Unknown ids must refuse, loudly, without touching anything
    if (doc.setProcessorState("t1", "nope", sha, 1) ||
        doc.setProcessorState("nope", "p1", sha, 1)) {
        std::cout << "FAILED: unknown target accepted\n";
        return false;
    }

    const auto read = doc.getDocument();
    if (read.tracks[0].chain[0].state_hash != sha ||
        read.tracks[0].chain[0].state_version != 3) {
        std::cout << "FAILED: state fields not read back\n";
        return false;
    }

    // The authored change applies onto an independent copy of the doc
    const auto change = doc.getLastLocalChange();
    if (change.empty()) {
        std::cout << "FAILED: no local change bytes\n";
        return false;
    }

    // Save/load roundtrip keeps the fields
    const auto bytes = doc.toBytes();
    daw::document::AutomergeDocument doc2;
    if (!doc2.loadFromBytes(bytes.data(), bytes.size())) {
        std::cout << "FAILED: reload\n";
        return false;
    }
    const auto read2 = doc2.getDocument();
    if (read2.tracks[0].chain[0].state_hash != sha ||
        read2.tracks[0].chain[0].state_version != 3) {
        std::cout << "FAILED: state fields lost across save/load\n";
        return false;
    }

    std::cout << "OK (authored, refused unknown ids, change bytes, save/load)\n";
    return true;
}

/**
 * V1.5 / A4-5: registry eviction. A node id removed from the document
 * must take its registry handle with it (bridge stopped, entry erased),
 * and only that one - survivors keep their ADDRESS (rebuilds re-attach
 * ProxyNodes to the same handle; a moved handle would dangle).
 * Bridge-less handles keep this a pure control-side unit test.
 */
bool testRegistryEviction() {
    std::cout << "Test: registry eviction (A4-5)... ";

    daw::graph::PluginInstanceRegistry registry;
    registry.ensure("node-a");
    auto* kept = &registry.ensure("node-b");
    registry.ensure("node-c");
    if (registry.size() != 3) {
        std::cout << "FAILED: expected 3 instances, got " << registry.size() << "\n";
        return false;
    }

    std::size_t evicted = registry.evictMissing(
        [](const std::string& id) { return id == "node-b"; });
    if (evicted != 2 || registry.size() != 1) {
        std::cout << "FAILED: evicted " << evicted << ", size "
                  << registry.size() << " (expected 2 evicted, 1 left)\n";
        return false;
    }
    if (registry.find("node-a") || registry.find("node-c")) {
        std::cout << "FAILED: evicted node still findable\n";
        return false;
    }
    if (registry.find("node-b") != kept) {
        std::cout << "FAILED: survivor moved or lost (handle address changed)\n";
        return false;
    }

    // Idempotent: nothing left to evict
    evicted = registry.evictMissing(
        [](const std::string& id) { return id == "node-b"; });
    if (evicted != 0 || registry.size() != 1) {
        std::cout << "FAILED: second pass evicted " << evicted << "\n";
        return false;
    }

    std::cout << "OK (2 evicted, survivor stable, idempotent)\n";
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
    run(testUtilityNode);
    run(testEq3Node);
    run(testCompressorNode);
    run(testDriveNode);
    run(testDelayNode);
    run(testRingBuffer);
    run(testDocumentSerialization);
    run(testWebAuthoredIntFields);
    run(testStemKeyPrecision);
    run(testDocMergePreservesLocal);
    run(testGetChangesNotIn);
    run(testDocumentClipsRoundTrip);
    run(testDocumentChainRoundTrip);
    run(testSha256AssetHash);
    runWithArg(testRenderDeterminism, fixtures_dir);
    run(testMasterGainRender);
    run(testAudioThreadLockFreedom);
    run(testTransportLoopAndStop);
    run(testRegistryEviction);
    run(testClipFadesRender);
    run(testProcessorStateInDocument);
    run(testWebSocketAuth);
#ifdef DAW_PLUGIN_HOST_EXE
    run(testPluginHostEnumeration);
    run(testPluginHostBadModule);
    run(testPluginHostProcessGain);
    run(testPluginHostSetupRefusal);
    run(testPluginBridgeTransparency);
    run(testProxyNodePipeline);
    run(testParamChannelSequence);
    run(testChildCrashRecovery);
    run(testPluginStateRoundtrip);
    run(testStemInvariant);
    run(testRealPluginMda);
    run(testDocumentChainRender);
#else
    std::cout << "(plugin_host tests skipped: VST3 SDK not vendored)\n";
#endif

    std::cout << "\n=== Results ===\n";
    std::cout << "Passed: " << passed << "\n";
    std::cout << "Failed: " << failed << "\n";

    return failed > 0 ? 1 : 0;
}
