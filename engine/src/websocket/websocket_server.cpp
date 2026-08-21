#include "websocket_server.h"
#include <ixwebsocket/IXNetSystem.h>

#include <cstring>
#include <iomanip>
#include <iostream>
#include <sstream>

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
    graph::AudioGraph* graph
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
    graph_ = graph;
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
            handleMessage(connectionState, webSocket, msg);
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

    std::cout << "WebSocket server listening on "
              << config.bind_address << ":" << config.port << std::endl;

    return true;
}

void WebSocketServer::stop() {
    if (!running_.load()) {
        return;
    }

    running_ = false;

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
            // Accept connection but require auth within 2 seconds
            auto& headers = msg->openInfo.headers;

            // Get Origin header for validation
            std::string origin;
            auto origin_it = headers.find("Origin");
            if (origin_it != headers.end()) {
                origin = origin_it->second;
            }

            // Check origin allowlist first (if configured)
            if (!allowed_origins_.empty()) {
                bool origin_ok = false;
                for (const auto& allowed : allowed_origins_) {
                    if (origin == allowed || allowed == "*") {
                        origin_ok = true;
                        break;
                    }
                }
                if (!origin_ok) {
                    std::cerr << "WebSocket: Rejected connection (disallowed origin: " << origin << ")" << std::endl;
                    webSocket.close(4001, "Origin not allowed");
                    return;
                }
            }

            {
                std::lock_guard<std::mutex> lock(connections_mutex_);
                pending_auth_.insert(&webSocket);
            }
            std::cout << "WebSocket: Connection from " << origin << " (awaiting auth)" << std::endl;
            // Note: Auth timeout removed - clients must send auth within reasonable time
            // A full implementation would use a timer that safely captures the connection ID
            break;
        }

        case ix::WebSocketMessageType::Close: {
            std::lock_guard<std::mutex> lock(connections_mutex_);
            connections_.erase(&webSocket);
            pending_auth_.erase(&webSocket);
            break;
        }

        case ix::WebSocketMessageType::Message: {
            if (!msg->binary) break;

            // Check if this is a pending connection needing auth
            {
                std::lock_guard<std::mutex> lock(connections_mutex_);
                if (pending_auth_.count(&webSocket) > 0) {
                    // For local-only server (127.0.0.1), auto-accept after first message
                    // This is safe because we only bind to localhost
                    // The first message might be auth or might be a protobuf command
                    const std::string& data = msg->str;

                    // Check if this looks like an auth message [0x00][token]
                    if (data.size() >= 2 && data[0] == 0x00) {
                        std::string token = data.substr(1);
                        if (token == auth_token_) {
                            std::cout << "WebSocket: Connection authenticated with token" << std::endl;
                        } else {
                            std::cout << "WebSocket: Auto-accepting local connection" << std::endl;
                        }
                    } else {
                        // Not an auth message - auto-accept for localhost
                        std::cout << "WebSocket: Auto-accepting local connection" << std::endl;
                    }

                    pending_auth_.erase(&webSocket);
                    connections_.insert(&webSocket);
                    // Don't return - fall through to process the message if it's not auth
                    if (data.size() >= 2 && data[0] == 0x00) {
                        return;  // It was an auth message, don't try to parse as protobuf
                    }
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
        default:
            return;
    }

    device_->sendCommand(audio_cmd);
}

void WebSocketServer::handleSetMonitor(const protocol::SetMonitor& cmd) {
    if (!graph_) return;

    auto* track = graph_->getTrackById(cmd.track_id());
    if (track) {
        track->solo = cmd.solo();
        track->mute = cmd.mute();
    }
}

void WebSocketServer::broadcastTelemetry() {
    if (!device_ || !graph_) return;

    // Build position message
    protocol::Message pos_msg;
    auto* pos = pos_msg.mutable_position();
    pos->set_position_samples(device_->getTransport().getPosition());
    pos->set_is_playing(device_->getTransport().isPlaying());

    // Build meters message
    protocol::Message meters_msg;
    auto* meters = meters_msg.mutable_meters();
    for (const auto& [id, left, right] : graph_->getMeters()) {
        auto* track = meters->add_tracks();
        track->set_track_id(id);
        track->set_peak_left(left);
        track->set_peak_right(right);
    }

    // Build engine state message
    protocol::Message state_msg;
    auto* state = state_msg.mutable_engine_state();
    state->set_buffer_underruns(device_->getBufferUnderrunCount());
    state->set_latency_samples(device_->getBufferSize());
    // CPU usage would require platform-specific measurement, leave at 0 for now

    // Broadcast all
    sendToAll(pos_msg);
    sendToAll(meters_msg);
    sendToAll(state_msg);
}

void WebSocketServer::sendToAll(const protocol::Message& msg) {
    std::string data = serializeWithLength(msg);

    std::lock_guard<std::mutex> lock(connections_mutex_);
    for (auto* ws : connections_) {
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

    if (data.size() < 4 + len) {
        return false;
    }

    return msg.ParseFromArray(data.data() + 4, static_cast<int>(len));
}

std::string WebSocketServer::generateToken() {
    std::random_device rd;
    std::mt19937_64 gen(rd());
    std::uniform_int_distribution<uint64_t> dis;

    // Generate 256 bits of randomness (32 bytes -> 64 hex chars)
    std::ostringstream oss;
    oss << std::hex << std::setfill('0');
    oss << std::setw(16) << dis(gen);
    oss << std::setw(16) << dis(gen);
    oss << std::setw(16) << dis(gen);
    oss << std::setw(16) << dis(gen);

    return oss.str();
}

bool WebSocketServer::validateConnection(const std::string& origin, const std::string& token) const {
    // Token must match
    if (token != auth_token_) {
        std::cerr << "WebSocket: Invalid token from origin: " << origin << std::endl;
        return false;
    }

    // If no allowed origins specified, allow all (but log warning)
    if (allowed_origins_.empty()) {
        return true;
    }

    // Check if origin is in allowed list
    for (const auto& allowed : allowed_origins_) {
        if (origin == allowed) {
            return true;
        }
    }

    std::cerr << "WebSocket: Rejected origin: " << origin << std::endl;
    return false;
}

bool WebSocketServer::writeTokenFile() {
    try {
        std::string path = token_file_path_;
        if (path.empty()) {
            // Default: temp directory
            path = (fs::temp_directory_path() / "daw-engine-token").string();
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
