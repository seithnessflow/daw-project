// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file websocket_server.h
 * @brief WebSocket server for browser communication.
 *
 * Exposes transport control and telemetry on 127.0.0.1.
 * Handles Chrome Local Network Access (LNA) preflight.
 */

#include "../audio/audio_device.h"
#include "../graph/audio_graph.h"
#include "messages.pb.h"

#include <ixwebsocket/IXWebSocketServer.h>
#include <ixwebsocket/IXHttpServer.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <random>
#include <set>
#include <string>
#include <thread>

namespace daw::websocket {

/**
 * WebSocket server configuration.
 */
struct WebSocketConfig {
    uint16_t port = 9000;
    std::string bind_address = "127.0.0.1";
    uint32_t telemetry_hz = 30;  // Telemetry send rate

    // Security
    std::string token_file_path;  // Where to write the auth token (empty = temp dir)

    // Origin allowlist for browser clients. Non-browser clients send no
    // Origin header and are exempt from this check (they still need the
    // token). "*" allows any origin. An empty list also allows any origin.
    std::vector<std::string> allowed_origins = {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    };
};

/**
 * WebSocket server for browser <-> engine communication.
 *
 * Features:
 * - Transport commands (play/stop/seek)
 * - Monitor commands (solo/mute per track)
 * - Telemetry broadcast (position, meters at 30 Hz)
 * - LNA preflight handling for Chrome >= 142
 */
class WebSocketServer {
public:
    WebSocketServer();
    ~WebSocketServer();

    // Non-copyable
    WebSocketServer(const WebSocketServer&) = delete;
    WebSocketServer& operator=(const WebSocketServer&) = delete;

    /**
     * Start the server.
     *
     * @param config Server configuration
     * @param device Audio device for transport commands
     * @param graph_slot Atomic slot holding the current audio graph. The
     *        server loads a shared_ptr copy before each use, so graph
     *        rebuilds are picked up automatically and retired graphs are
     *        never dereferenced. The slot must outlive the server (it lives
     *        in the AudioDevice).
     * @return true on success
     */
    bool start(
        const WebSocketConfig& config,
        audio::AudioDevice* device,
        const std::atomic<std::shared_ptr<graph::AudioGraph>>* graph_slot
    );

    /**
     * Stop the server.
     */
    void stop();

    /**
     * Check if server is running.
     */
    bool isRunning() const { return running_.load(); }

    /**
     * Get the port the server is listening on.
     */
    uint16_t getPort() const { return port_; }

    /**
     * Broadcast telemetry to all connected clients.
     * Called from the main loop at telemetry_hz rate.
     */
    void broadcastTelemetry();

    /**
     * Optional 2.4c-1 counter: bridge blocks bypassed (child late/dead).
     * Owned by the plugin registry handle on the control side; must outlive
     * this server. Written by the audio callback (relaxed), read here.
     */
    void setPluginBlocksMissed(const std::atomic<uint64_t>* counter) {
        plugin_blocks_missed_ = counter;
    }

private:
    // Message handlers
    void handleMessage(std::shared_ptr<ix::ConnectionState> connectionState,
                       ix::WebSocket& webSocket,
                       const ix::WebSocketMessagePtr& msg);
    void handleTransportCommand(const protocol::TransportCommand& cmd);
    void handleSetMonitor(const protocol::SetMonitor& cmd);

    // Send helpers
    void sendToAll(const protocol::Message& msg);

    // Serialize message with length prefix (4 bytes big-endian)
    std::string serializeWithLength(const protocol::Message& msg);

    // Parse message from length-prefixed data
    bool parseWithLength(const std::string& data, protocol::Message& msg);

    // Server
    std::unique_ptr<ix::WebSocketServer> server_;
    std::atomic<bool> running_{false};
    uint16_t port_ = 0;

    // Connections tracking
    struct PendingAuth {
        std::string origin;
        std::chrono::steady_clock::time_point deadline;
    };
    std::set<ix::WebSocket*> connections_;          // Authenticated connections
    std::map<ix::WebSocket*, PendingAuth> pending_auth_;  // Awaiting auth
    std::mutex connections_mutex_;

    // Auth timeout: close connections that don't auth within 2 seconds
    static constexpr int AUTH_TIMEOUT_MS = 2000;

    // Reaper thread: closes pending connections whose deadline expired
    std::thread auth_reaper_;
    void authReaperLoop();

    // References (not owned)
    audio::AudioDevice* device_ = nullptr;
    const std::atomic<std::shared_ptr<graph::AudioGraph>>* graph_slot_ = nullptr;
    const std::atomic<uint64_t>* plugin_blocks_missed_ = nullptr;

    // Telemetry
    uint32_t telemetry_hz_ = 30;

    // Security
    std::string auth_token_;
    std::string token_file_path_;
    std::vector<std::string> allowed_origins_;

    // Generate cryptographically secure random token
    static std::string generateToken();

    // Validate connection based on Origin header and token
    bool validateConnection(const std::string& origin, const std::string& token) const;

    // Check an Origin header value against the allowlist
    bool originAllowed(const std::string& origin) const;

    // Write token to file for local clients
    bool writeTokenFile();
};

}  // namespace daw::websocket
