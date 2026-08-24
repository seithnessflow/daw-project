// SPDX-License-Identifier: GPL-3.0-or-later
#include "server_client.h"

#include <ixwebsocket/IXNetSystem.h>
#include <ixwebsocket/IXWebSocket.h>

#include <iostream>

namespace daw::network {

// Network system initialization (may be shared with websocket_server)
static bool s_net_initialized = false;

ServerClient::ServerClient() = default;

ServerClient::~ServerClient() {
    disconnect();
}

bool ServerClient::connect(const ServerConfig& config) {
    if (connected_.load()) {
        return false;
    }

    config_ = config;

    // Initialize network system (required on Windows for WSAStartup)
    // Note: This may already be done by WebSocketServer, but initNetSystem is idempotent
    if (!s_net_initialized) {
        if (!ix::initNetSystem()) {
            std::cerr << "ServerClient error: Failed to initialize network system" << std::endl;
            return false;
        }
        s_net_initialized = true;
    }

    // Build URL: ws://localhost:3000/ws/{project_id}
    std::string url = config_.url + "/ws/" + config_.project_id;
    std::cout << "ServerClient: Connecting to " << url << std::endl;

    ws_ = std::make_unique<ix::WebSocket>();
    ws_->setUrl(url);

    // Disable per-message deflate for lower latency
    ws_->disablePerMessageDeflate();

    // Set message callback
    ws_->setOnMessageCallback([this](const ix::WebSocketMessagePtr& msg) {
        switch (msg->type) {
            case ix::WebSocketMessageType::Open:
                std::cout << "ServerClient: Connected to server" << std::endl;
                connected_ = true;
                received_initial_ = false;
                if (connection_callback_) {
                    connection_callback_(true);
                }
                break;

            case ix::WebSocketMessageType::Close:
                std::cout << "ServerClient: Disconnected from server (code="
                          << msg->closeInfo.code << ", reason=" << msg->closeInfo.reason << ")" << std::endl;
                std::cout << std::flush;
                connected_ = false;
                if (connection_callback_) {
                    connection_callback_(false);
                }
                break;

            case ix::WebSocketMessageType::Message:
                if (msg->binary) {
                    handleMessage(msg->str);
                }
                break;

            case ix::WebSocketMessageType::Error:
                std::cerr << "ServerClient error: " << msg->errorInfo.reason << std::endl;
                break;

            default:
                break;
        }
    });

    // Enable auto-reconnect - and HEARTBEAT, because reconnection is
    // useless without dead-peer detection: a server killed under us
    // (every offline-spec run does it) left a ZOMBIE socket - the engine
    // played a frozen document indefinitely, receiving nothing, logging
    // nothing (found 2026-08-22 by the life layer's meter probe: the
    // telemetry showed 14 tracks while the document had 19). A 15 s ping
    // turns that silence into a Close, and the reconnect brings the
    // fresh document.
    ws_->enableAutomaticReconnection();
    ws_->setPingInterval(15);

    // Start connection
    ws_->start();

    return true;
}

void ServerClient::sendSignal(const std::string& json) {
    if (ws_ && connected_) {
        ws_->sendText("signal:" + json);
    }
}

void ServerClient::disconnect() {
    if (ws_) {
        ws_->stop();
        ws_.reset();
    }
    connected_ = false;
}

void ServerClient::handleMessage(const std::string& data) {
    // First message is the initial document, subsequent are changes
    std::vector<uint8_t> bytes(data.begin(), data.end());

    if (!received_initial_.load()) {
        received_initial_ = true;
        std::cout << "ServerClient: Received initial document (" << bytes.size() << " bytes)" << std::endl;
        if (document_callback_) {
            document_callback_(bytes);
        }
    } else {
        std::cout << "ServerClient: Received change (" << bytes.size() << " bytes)" << std::endl;
        if (change_callback_) {
            std::cout << "ServerClient: Calling change callback..." << std::endl;
            change_callback_(bytes);
            std::cout << "ServerClient: Change callback returned" << std::endl;
        } else {
            std::cerr << "ServerClient: WARNING - no change_callback set!" << std::endl;
        }
    }
}

void ServerClient::sendChange(const std::vector<uint8_t>& change) {
    if (!connected_.load() || !ws_) {
        return;
    }

    std::string data(change.begin(), change.end());
    ws_->sendBinary(data);
}

}  // namespace daw::network
