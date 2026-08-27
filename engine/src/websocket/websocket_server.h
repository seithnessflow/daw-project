// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file websocket_server.h
 * @brief WebSocket server for browser communication.
 *
 * Exposes transport control and telemetry on 127.0.0.1.
 * NOTE: no HTTP/LNA preflight handling exists here (criterion 4 is
 * untested); an earlier version of this comment claimed otherwise.
 */

#include "../audio/audio_device.h"
#include "../audio/tap_ring.h"
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

    /** c-2: child liveness + restart attempts, same ownership rules. */
    void setPluginChildState(const std::atomic<bool>* alive,
                             const std::atomic<uint32_t>* restarts) {
        plugin_child_alive_ = alive;
        plugin_child_restarts_ = restarts;
    }

    /**
     * S8a: attach the master tap ring (owned by the caller, written by
     * the audio callback). The ring's `enabled` flag follows the
     * subscriber count.
     */
    void setTapRing(audio::TapRing* ring) { tap_ring_ = ring; }

    /**
     * S8a: drain pending tap blocks to the subscribed clients. Called
     * EVERY main-loop tick (not at telemetry rate - the jam road wants
     * the freshest blocks). No subscribers or no ring = free.
     */
    void pumpTap();

    /**
     * 2.5-decouverte : le catalogue de plugins (trame protobuf deja
     * serialisee avec prefixe longueur), envoye UNE fois par connexion
     * a l'authentification. A poser AVANT start().
     */
    void setCatalogFrame(std::string frame) { catalog_frame_ = std::move(frame); }

    /**
     * Export mixdown (AUDIT-6 QW1) : le proprietaire (main) fournit le
     * demarrage d'un export. Appele sur le THREAD RESEAU du serveur WS -
     * le handler doit deleguer le rendu (ExportJob), jamais rendre ici.
     * Absent (mode fichier) = la demande recoit un FAILED explicite.
     */
    void setRenderRequestHandler(std::function<void(uint32_t bit_depth)> h) {
        render_request_handler_ = std::move(h);
    }

    /**
     * Diffuse un RenderState a tous les clients. Thread-safe (sendToAll :
     * copie sous verrou, envoi hors verrou) - appelable du thread ouvrier
     * de l'export comme du thread reseau.
     */
    void sendRenderState(protocol::RenderState::Status status,
                         const std::string& wav_hash,
                         const std::string& error,
                         uint64_t length_samples = 0,
                         uint32_t sample_rate = 0,
                         uint32_t bit_depth = 0);

private:
    std::function<void(uint32_t)> render_request_handler_;
    std::string catalog_frame_;
    // Message handlers
    void handleMessage(std::shared_ptr<ix::ConnectionState> connectionState,
                       ix::WebSocket& webSocket,
                       const ix::WebSocketMessagePtr& msg);
    void handleTransportCommand(const protocol::TransportCommand& cmd);
    void handleSetMonitor(const protocol::SetMonitor& cmd);
    void handleTapControl(ix::WebSocket* ws, const protocol::TapControl& cmd);
    void handleEditor(const protocol::EditorControl& cmd);  // v9 : fenetre GUI a la demande
    void handleSessionLaunch(const protocol::SessionLaunch& cmd);  // F5 : launch Session

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
    const std::atomic<bool>* plugin_child_alive_ = nullptr;
    const std::atomic<uint32_t>* plugin_child_restarts_ = nullptr;

    // S8a: master tap (owned by main; audio-thread writer)
    audio::TapRing* tap_ring_ = nullptr;
    std::set<ix::WebSocket*> tap_subscribers_;  // guarded by connections_mutex_

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
