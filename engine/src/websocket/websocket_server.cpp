// SPDX-License-Identifier: GPL-3.0-or-later
#include "websocket_server.h"
#include <ixwebsocket/IXNetSystem.h>

#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")
#endif

namespace daw::websocket {

// Static initialization flag
static bool g_net_system_initialized = false;

namespace fs = std::filesystem;

WebSocketServer::WebSocketServer() = default;

WebSocketServer::~WebSocketServer() {
    stop();
}

bool WebSocketServer::start(
    const WebSocketConfig& config,
    audio::AudioDevice* device,
    const std::atomic<std::shared_ptr<graph::AudioGraph>>* graph_slot
) {
    if (running_.load()) {
        return false;
    }

    // Initialize network system (required on Windows for WSAStartup)
    if (!g_net_system_initialized) {
        if (!ix::initNetSystem()) {
            std::cerr << "WebSocket server error: Failed to initialize network system" << std::endl;
            return false;
        }
        g_net_system_initialized = true;
    }

    device_ = device;
    graph_slot_ = graph_slot;
    port_ = config.port;
    telemetry_hz_ = config.telemetry_hz;
    allowed_origins_ = config.allowed_origins;
    token_file_path_ = config.token_file_path;

    // Generate auth token
    auth_token_ = generateToken();

    // Write token file for local clients
    if (!writeTokenFile()) {
        std::cerr << "Warning: Failed to write auth token file" << std::endl;
    }

    server_ = std::make_unique<ix::WebSocketServer>(
        config.port,
        config.bind_address
    );

    // Disable per-message deflate for lower latency
    server_->disablePerMessageDeflate();

    // Set message handler - handles connection open/close and messages
    server_->setOnClientMessageCallback(
        [this](std::shared_ptr<ix::ConnectionState> connectionState,
               ix::WebSocket& webSocket,
               const ix::WebSocketMessagePtr& msg) {
            // Ceinture (crash 0xe06d7363) : une exception qui traverse
            // cette frontiere remonte dans les threads d'ixwebsocket et
            // tue le moteur - on attrape, on hurle, on continue.
            try {
                handleMessage(connectionState, webSocket, msg);
            } catch (const std::exception& e) {
                std::cerr << "WebSocket handler exception (survived): "
                          << e.what() << std::endl;
            } catch (...) {
                std::cerr << "WebSocket handler unknown exception (survived)"
                          << std::endl;
            }
        }
    );

    auto res = server_->listen();
    if (!res.first) {
        std::cerr << "WebSocket server error: " << res.second << std::endl;
        return false;
    }

    // Start in background
    server_->start();
    running_ = true;

    // Reaper: closes connections that stay unauthenticated past the deadline
    auth_reaper_ = std::thread([this]() { authReaperLoop(); });

    std::cout << "WebSocket server listening on "
              << config.bind_address << ":" << config.port << std::endl;

    return true;
}

void WebSocketServer::stop() {
    if (!running_.load()) {
        return;
    }

    running_ = false;

    if (auth_reaper_.joinable()) {
        auth_reaper_.join();
    }

    if (server_) {
        server_->stop();
        server_.reset();
    }

    std::lock_guard<std::mutex> lock(connections_mutex_);
    connections_.clear();
}

void WebSocketServer::handleMessage(
    std::shared_ptr<ix::ConnectionState> connectionState,
    ix::WebSocket& webSocket,
    const ix::WebSocketMessagePtr& msg
) {
    switch (msg->type) {
        case ix::WebSocketMessageType::Open: {
            // Accept connection but require auth within AUTH_TIMEOUT_MS
            auto& headers = msg->openInfo.headers;

            // Get Origin header for validation
            std::string origin;
            auto origin_it = headers.find("Origin");
            if (origin_it != headers.end()) {
                origin = origin_it->second;
            }

            // Browsers always send Origin: reject disallowed ones outright.
            // Native clients send no Origin and pass this check, but still
            // have to present the token.
            if (!origin.empty() && !originAllowed(origin)) {
                std::cerr << "WebSocket: Rejected connection (disallowed origin: " << origin << ")" << std::endl;
                webSocket.close(4001, "Origin not allowed");
                return;
            }

            {
                std::lock_guard<std::mutex> lock(connections_mutex_);
                pending_auth_[&webSocket] = PendingAuth{
                    origin,
                    std::chrono::steady_clock::now() + std::chrono::milliseconds(AUTH_TIMEOUT_MS)
                };
            }
            std::cout << "WebSocket: Connection from "
                      << (origin.empty() ? "(no origin)" : origin)
                      << " (awaiting auth)" << std::endl;
            break;
        }

        case ix::WebSocketMessageType::Close: {
            std::lock_guard<std::mutex> lock(connections_mutex_);
            connections_.erase(&webSocket);
            pending_auth_.erase(&webSocket);
            // S8a: a vanished subscriber must not keep the tap warm
            tap_subscribers_.erase(&webSocket);
            if (tap_ring_ && tap_subscribers_.empty()) {
                tap_ring_->enabled.store(false, std::memory_order_release);
            }
            break;
        }

        case ix::WebSocketMessageType::Message: {
            if (!msg->binary) break;

            // Authentication gate: the FIRST message on a connection must be
            // [0x00][token] with a valid token. Anything else closes the
            // connection with 4001.
            std::string pending_origin;
            bool was_pending = false;
            {
                std::lock_guard<std::mutex> lock(connections_mutex_);
                auto it = pending_auth_.find(&webSocket);
                if (it != pending_auth_.end()) {
                    was_pending = true;
                    pending_origin = it->second.origin;
                    pending_auth_.erase(it);
                }
            }

            if (was_pending) {
                const std::string& data = msg->str;
                if (data.size() < 2 || data[0] != '\x00') {
                    std::cerr << "WebSocket: Rejected connection (first message is not auth)" << std::endl;
                    webSocket.close(4001, "Authentication required");
                    return;
                }

                const std::string token = data.substr(1);
                if (!validateConnection(pending_origin, token)) {
                    webSocket.close(4001, "Invalid token or origin");
                    return;
                }

                {
                    std::lock_guard<std::mutex> lock(connections_mutex_);
                    connections_.insert(&webSocket);
                }
                std::cout << "WebSocket: Connection authenticated" << std::endl;
                // 2.5-decouverte : le catalogue part une fois, ici -
                // l'onglet sait quoi proposer au menu + device
                if (!catalog_frame_.empty()) {
                    webSocket.sendBinary(catalog_frame_);
                }
                return;  // Auth message is consumed, never parsed as protobuf
            }

            // Only authenticated connections may issue commands
            {
                std::lock_guard<std::mutex> lock(connections_mutex_);
                if (connections_.count(&webSocket) == 0) {
                    return;
                }
            }

            // Regular message from authenticated connection
            // Parse length-prefixed protobuf message
            protocol::Message message;
            if (!parseWithLength(msg->str, message)) {
                return;
            }

            // Handle based on message type
            switch (message.payload_case()) {
                case protocol::Message::kTransport:
                    handleTransportCommand(message.transport());
                    break;
                case protocol::Message::kSetMonitor:
                    handleSetMonitor(message.set_monitor());
                    break;
                case protocol::Message::kTapControl:
                    handleTapControl(&webSocket, message.tap_control());
                    break;
                default:
                    break;
            }
            break;
        }

        case ix::WebSocketMessageType::Error: {
            std::cerr << "WebSocket error: " << msg->errorInfo.reason << std::endl;
            break;
        }

        default:
            break;
    }
}

void WebSocketServer::handleTransportCommand(const protocol::TransportCommand& cmd) {
    if (!device_) return;

    audio::AudioCommandMessage audio_cmd{};

    switch (cmd.action()) {
        case protocol::TransportCommand::PLAY:
            audio_cmd.command = audio::AudioCommand::Play;
            break;
        case protocol::TransportCommand::STOP:
            audio_cmd.command = audio::AudioCommand::Stop;
            break;
        case protocol::TransportCommand::SEEK:
            audio_cmd.command = audio::AudioCommand::Seek;
            audio_cmd.seek_position = cmd.seek_position();
            break;
        case protocol::TransportCommand::LOOP:
            audio_cmd.command = audio::AudioCommand::SetLoop;
            audio_cmd.loop_enabled = cmd.loop_enabled();
            break;
        default:
            return;
    }

    device_->sendCommand(audio_cmd);
}

void WebSocketServer::handleTapControl(ix::WebSocket* ws,
                                       const protocol::TapControl& cmd) {
    if (!tap_ring_) return;
    std::lock_guard<std::mutex> lock(connections_mutex_);
    if (cmd.enabled()) {
        tap_subscribers_.insert(ws);
    } else {
        tap_subscribers_.erase(ws);
    }
    tap_ring_->enabled.store(!tap_subscribers_.empty(),
                             std::memory_order_release);
    std::cout << "Master tap: " << tap_subscribers_.size()
              << " subscriber(s)" << std::endl;
}

void WebSocketServer::pumpTap() {
    if (!tap_ring_) return;
    audio::TapRing& ring = *tap_ring_;
    uint64_t r = ring.read_idx.load(std::memory_order_relaxed);
    const uint64_t w = ring.write_idx.load(std::memory_order_acquire);
    if (r == w) return;

    // Batch everything pending into ONE message (at a ~1 ms pump the
    // batch is 1-2 blocks; after a stall it catches up whole).
    protocol::Message msg;
    auto* tap = msg.mutable_audio_tap();
    tap->set_first_seq(r);
    std::string* bytes = tap->mutable_samples();
    uint32_t count = 0;
    while (r < w && count < audio::TapRing::kSlots) {
        bytes->append(
            reinterpret_cast<const char*>(ring.blocks[r % audio::TapRing::kSlots]),
            audio::TapRing::kBlockSamples * sizeof(float));
        ++r;
        ++count;
    }
    ring.read_idx.store(r, std::memory_order_release);
    tap->set_block_count(count);
    tap->set_dropped_blocks(ring.dropped.load(std::memory_order_relaxed));

    const std::string data = serializeWithLength(msg);
    // Meme regle que sendToAll : envoi HORS verrou (la reentrance Close
    // sous ce mutex etait LE crash 0xe06d7363)
    std::vector<std::shared_ptr<ix::WebSocket>> targets;
    if (server_) {
        auto clients = server_->getClients();
        std::lock_guard<std::mutex> lock(connections_mutex_);
        for (const auto& c : clients) {
            if (tap_subscribers_.count(c.get())) targets.push_back(c);
        }
    }
    for (const auto& ws : targets) {
        ws->sendBinary(data);
    }
}

void WebSocketServer::handleSetMonitor(const protocol::SetMonitor& cmd) {
    if (!graph_slot_) return;

    // Acquire a shared_ptr copy: keeps the graph alive for the duration of
    // this call even if the control thread swaps it concurrently.
    auto graph = graph_slot_->load(std::memory_order_acquire);
    if (!graph) return;

    auto* track = graph->getTrackById(cmd.track_id());
    if (track) {
        track->solo.store(cmd.solo(), std::memory_order_relaxed);
        track->mute.store(cmd.mute(), std::memory_order_relaxed);
    }
}

void WebSocketServer::broadcastTelemetry() {
    if (!device_ || !graph_slot_) return;

    // Acquire a shared_ptr copy for this broadcast (see handleSetMonitor).
    auto graph = graph_slot_->load(std::memory_order_acquire);
    if (!graph) return;

    // Build position message
    protocol::Message pos_msg;
    auto* pos = pos_msg.mutable_position();
    pos->set_position_samples(device_->getTransport().getPosition());
    pos->set_is_playing(device_->getTransport().isPlaying());

    // Build meters message
    protocol::Message meters_msg;
    auto* meters = meters_msg.mutable_meters();
    for (const auto& [id, left, right] : graph->getMeters()) {
        auto* track = meters->add_tracks();
        track->set_track_id(id);
        track->set_peak_left(left);
        track->set_peak_right(right);
    }
    // V1.2: master peaks (post-gain), computed in AudioGraph::process
    const auto [mpl, mpr] = graph->getMasterPeaks();
    meters->set_master_peak_left(mpl);
    meters->set_master_peak_right(mpr);

    // Build engine state message
    protocol::Message state_msg;
    auto* state = state_msg.mutable_engine_state();
    state->set_buffer_underruns(device_->getBufferUnderrunCount());
    // 2.4d (AUDIT R3): output latency = device buffer + the graph's own
    // declared latency (plugin pipelines) - computed, never a constant
    state->set_latency_samples(device_->getBufferSize() +
                               (graph ? graph->getLatencySamples() : 0));
    // CPU usage would require platform-specific measurement, leave at 0 for now
    if (plugin_blocks_missed_) {
        state->set_plugin_blocks_missed(
            plugin_blocks_missed_->load(std::memory_order_relaxed));
    }
    if (plugin_child_alive_) {
        state->set_plugin_child_alive(
            plugin_child_alive_->load(std::memory_order_relaxed));
    }
    if (plugin_child_restarts_) {
        state->set_plugin_child_restarts(
            plugin_child_restarts_->load(std::memory_order_relaxed));
    }

    // Broadcast all
    sendToAll(pos_msg);
    sendToAll(meters_msg);
    sendToAll(state_msg);
}

void WebSocketServer::sendToAll(const protocol::Message& msg) {
    std::string data = serializeWithLength(msg);

    // COPIE SOUS VERROU, ENVOI HORS VERROU (crash 0xe06d7363, repro
    // 2026-08-25) : un send vers un client parti brutalement echoue,
    // ixwebsocket bascule setReadyState(CLOSED) et rappelle la callback
    // Close SYNCHRONEMENT SUR CE THREAD - qui reprenait ce mutex :
    // self-lock detecte par la STL MSVC = system_error("resource
    // deadlock would occur") jamais rattrape, mort du moteur (les deux
    // machines, le meme jour). Les shared_ptr du serveur ix gardent
    // chaque objet vivant pendant l'envoi.
    std::vector<std::shared_ptr<ix::WebSocket>> targets;
    if (server_) {
        auto clients = server_->getClients();
        std::lock_guard<std::mutex> lock(connections_mutex_);
        for (const auto& c : clients) {
            if (connections_.count(c.get())) targets.push_back(c);
        }
    }
    for (const auto& ws : targets) {
        ws->sendBinary(data);
    }
}

std::string WebSocketServer::serializeWithLength(const protocol::Message& msg) {
    std::string payload;
    msg.SerializeToString(&payload);

    // 4-byte big-endian length prefix
    uint32_t len = static_cast<uint32_t>(payload.size());
    std::string result(4 + payload.size(), '\0');
    result[0] = static_cast<char>((len >> 24) & 0xFF);
    result[1] = static_cast<char>((len >> 16) & 0xFF);
    result[2] = static_cast<char>((len >> 8) & 0xFF);
    result[3] = static_cast<char>(len & 0xFF);
    std::memcpy(&result[4], payload.data(), payload.size());

    return result;
}

bool WebSocketServer::parseWithLength(const std::string& data, protocol::Message& msg) {
    if (data.size() < 4) {
        return false;
    }

    // Read 4-byte big-endian length
    uint32_t len = (static_cast<uint8_t>(data[0]) << 24) |
                   (static_cast<uint8_t>(data[1]) << 16) |
                   (static_cast<uint8_t>(data[2]) << 8) |
                   static_cast<uint8_t>(data[3]);

    // Audit M2: compute in size_t - `4 + len` in uint32 wraps for a len
    // near UINT32_MAX and would skip the bounds check.
    if (data.size() < static_cast<size_t>(len) + 4) {
        return false;
    }

    return msg.ParseFromArray(data.data() + 4, static_cast<int>(len));
}

std::string WebSocketServer::generateToken() {
    // Audit H1: mt19937_64 seeded from one random_device draw has ~32
    // bits of real entropy - the "256-bit" token was determined by a
    // single 32-bit seed. Fill 32 bytes straight from the OS CSPRNG.
    unsigned char buf[32];
#ifdef _WIN32
    if (BCryptGenRandom(nullptr, buf, sizeof(buf),
                        BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) {
        std::cerr << "FATAL: BCryptGenRandom failed for auth token" << std::endl;
        std::abort();  // a weak token is worse than no server
    }
#else
    std::ifstream urandom("/dev/urandom", std::ios::binary);
    if (!urandom.read(reinterpret_cast<char*>(buf), sizeof(buf))) {
        std::cerr << "FATAL: /dev/urandom read failed for auth token" << std::endl;
        std::abort();
    }
#endif
    std::ostringstream oss;
    oss << std::hex << std::setfill('0');
    for (unsigned char b : buf) {
        oss << std::setw(2) << static_cast<int>(b);
    }
    return oss.str();  // 32 bytes -> 64 hex chars
}

/** Constant-time equality (audit H1): a plain != leaks timing that can
 *  narrow a token byte by byte. Compares the full length always. */
static bool constantTimeEquals(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    unsigned char diff = 0;
    for (size_t i = 0; i < a.size(); ++i) {
        diff |= static_cast<unsigned char>(a[i]) ^ static_cast<unsigned char>(b[i]);
    }
    return diff == 0;
}

bool WebSocketServer::validateConnection(const std::string& origin, const std::string& token) const {
    // Token must match (constant-time, audit H1)
    if (!constantTimeEquals(token, auth_token_)) {
        std::cerr << "WebSocket: Invalid token from origin: "
                  << (origin.empty() ? "(no origin)" : origin) << std::endl;
        return false;
    }

    // Browser clients must come from an allowed origin. Native clients
    // (no Origin header) are exempt: the token is their credential.
    if (!origin.empty() && !originAllowed(origin)) {
        std::cerr << "WebSocket: Rejected origin: " << origin << std::endl;
        return false;
    }

    return true;
}

bool WebSocketServer::originAllowed(const std::string& origin) const {
    if (allowed_origins_.empty()) {
        return true;
    }
    for (const auto& allowed : allowed_origins_) {
        if (allowed == "*" || allowed == origin) {
            return true;
        }
    }
    return false;
}

void WebSocketServer::authReaperLoop() {
    while (running_.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        if (!running_.load() || !server_) {
            break;
        }

        // getClients() hands out shared_ptrs, so a connection cannot be
        // destroyed between our check and the close() call.
        auto clients = server_->getClients();
        const auto now = std::chrono::steady_clock::now();

        std::vector<std::shared_ptr<ix::WebSocket>> expired;
        {
            std::lock_guard<std::mutex> lock(connections_mutex_);
            for (const auto& client : clients) {
                auto it = pending_auth_.find(client.get());
                if (it != pending_auth_.end() && now >= it->second.deadline) {
                    expired.push_back(client);
                    pending_auth_.erase(it);
                }
            }
        }

        for (const auto& client : expired) {
            std::cout << "WebSocket: Closing unauthenticated connection (timeout)" << std::endl;
            client->close(4001, "Authentication timeout");
        }
    }
}

bool WebSocketServer::writeTokenFile() {
    try {
        std::string path = token_file_path_;
        if (path.empty()) {
            // Default: temp directory, PER PORT - the global file was a
            // collision farm: spec-spawned engines (ports 47901/47902)
            // clobbered the interactive engine's token, killing every
            // new page's engine connection (found twice in one day,
            // 2026-08-22). Readers key on the port they dial.
            path = (fs::temp_directory_path() /
                    ("daw-engine-token-" + std::to_string(port_))).string();
        }

        std::ofstream file(path);
        if (!file) {
            std::cerr << "Failed to write token file: " << path << std::endl;
            return false;
        }

        // Write JSON format for easy parsing by clients
        file << "{\n";
        file << "  \"token\": \"" << auth_token_ << "\",\n";
        file << "  \"port\": " << port_ << ",\n";
        file << "  \"address\": \"127.0.0.1\"\n";
        file << "}\n";

        token_file_path_ = path;
        std::cout << "Auth token written to: " << path << std::endl;
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Error writing token file: " << e.what() << std::endl;
        return false;
    }
}

}  // namespace daw::websocket
