// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file server_client.h
 * @brief WebSocket client for connecting to the sync server.
 *
 * Subscribes to Automerge document updates from the server.
 * When the document changes (e.g., gain modified in browser),
 * the engine rebuilds its audio graph.
 */

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace ix {
class WebSocket;
}

namespace daw::network {

/**
 * Callback for receiving the initial document.
 *
 * @param data Document binary data
 */
using DocumentCallback = std::function<void(const std::vector<uint8_t>& data)>;

/**
 * Callback for receiving document changes.
 *
 * @param change Change binary data
 */
using ChangeCallback = std::function<void(const std::vector<uint8_t>& change)>;

/**
 * Server client configuration.
 */
struct ServerConfig {
    std::string url = "ws://localhost:3000";
    std::string project_id = "default";
    uint32_t reconnect_delay_ms = 3000;
};

/**
 * WebSocket client for sync server.
 *
 * Connects to the server and subscribes to document updates.
 */
class ServerClient {
public:
    ServerClient();
    ~ServerClient();

    // Non-copyable
    ServerClient(const ServerClient&) = delete;
    ServerClient& operator=(const ServerClient&) = delete;

    /**
     * Connect to the server.
     *
     * @param config Connection configuration
     * @return true if connection initiated (async)
     */
    bool connect(const ServerConfig& config);

    /**
     * Disconnect from the server.
     */
    void disconnect();

    /**
     * Check if connected.
     */
    bool isConnected() const { return connected_.load(); }

    /**
     * Set callback for initial document.
     */
    void setDocumentCallback(DocumentCallback callback) {
        document_callback_ = std::move(callback);
    }

    /**
     * Set callback for document changes.
     */
    void setChangeCallback(ChangeCallback callback) {
        change_callback_ = std::move(callback);
    }

    /**
     * Set callback for connection state changes.
     */
    void setConnectionCallback(std::function<void(bool)> callback) {
        connection_callback_ = std::move(callback);
    }

    /**
     * Send a change to the server (for local mutations).
     *
     * @param change Change binary data
     */
    void sendChange(const std::vector<uint8_t>& change);

    /**
     * Session 3 (fraicheur) : signal ephemere texte via le relais du
     * serveur (prefixe "signal:", relaye verbatim aux pairs du projet).
     * Jamais dans le document. No-op deconnecte.
     */
    void sendSignal(const std::string& json);

private:
    std::unique_ptr<ix::WebSocket> ws_;
    std::atomic<bool> connected_{false};
    std::atomic<bool> received_initial_{false};

    DocumentCallback document_callback_;
    ChangeCallback change_callback_;
    std::function<void(bool)> connection_callback_;

    ServerConfig config_;

    void handleMessage(const std::string& data);
};

}  // namespace daw::network
