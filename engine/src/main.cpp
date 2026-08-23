// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file main.cpp
 * @brief DAW Engine CLI
 *
 * Command-line interface for the DAW audio engine.
 *
 * Usage:
 *   engine --doc <file> --play              Play the project
 *   engine --doc <file> --render <output>   Render to WAV file
 *   engine --doc <file> --info              Show project info
 *   engine --help                           Show help
 */

#include "audio/audio_device.h"
#include "document/automerge_document.h"
#include "graph/audio_graph.h"
#include "graph/clip_player.h"
#include "graph/graph_common.h"
#include "graph/plugin_registry.h"
#include "host/plugin_bridge.h"
#include "host/proxy_node.h"
#include "network/server_client.h"
#include "util/sha256.h"

#include <ixwebsocket/IXHttpClient.h>
#include "render/offline_render.h"
#include "websocket/websocket_server.h"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <map>
#include <set>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <csignal>
#include <atomic>
#include <vector>

namespace fs = std::filesystem;

// Global flag for signal handling
static std::atomic<bool> g_running{true};

void signalHandler(int /*signum*/) {
    g_running = false;
}

void printUsage(const char* program) {
    std::cout << "DAW Engine CLI\n"
              << "\n"
              << "Usage:\n"
              << "  " << program << " --server <url> --play [--project <id>] [--assets <dir>]\n"
              << "  " << program << " --doc <file.am> --play [--assets <dir>] [--ws-port <port>]\n"
              << "  " << program << " --doc <file.am> --render <output.wav> [--assets <dir>]\n"
              << "  " << program << " --doc <file.am> --info\n"
              << "  " << program << " --help\n"
              << "\n"
              << "Options:\n"
              << "  --server <url>     Sync server URL (e.g., ws://localhost:3000)\n"
              << "  --project <id>     Project ID for server sync (default: 'default')\n"
              << "  --doc <file>       Project document file (Automerge binary .am)\n"
              << "  --play             Play the project through audio device\n"
              << "  --render <file>    Render to WAV file\n"
              << "  --assets <dir>     Directory containing audio assets (default: same as doc)\n"
              << "  --info             Show project information\n"
              << "  --mute             Use null audio backend (silent playback for testing)\n"
              << "  --keepalive        File mode: loop the document instead of exiting at its end\n"
              << "  --sample-rate <n>  Sample rate for rendering (default: 48000)\n"
              << "  --bit-depth <n>    Bit depth for rendering (16, 24, 32; default: 24)\n"
              << "  --ws-port <n>      WebSocket server port (default: 47821)\n"
              << "  --debug-proxy-again <path.vst3>\n"
              << "                     Test hook (2.4c-1): AGain in a child process,\n"
              << "                     proxied on the first track's chain\n"
              << "  --vst3-module <uid>=<path.vst3>\n"
              << "                     Resolve a document chain node (type vst3, by\n"
              << "                     class uid) to a module on disk. Repeatable.\n"
              << "  --allow-origin <o> Allow an extra browser Origin on the WebSocket\n"
              << "                     server (can be used multiple times; defaults\n"
              << "                     allow http://localhost:5173 and http://127.0.0.1:5173)\n"
              << "  --solo <track-id>  Solo specified track (can be used multiple times)\n"
              << "  --mute-track <id>  Mute specified track (can be used multiple times)\n"
              << "  --list-devices     List available audio devices and exit\n"
              << "  --device <name>    Select audio device by name (substring match)\n"
              << "  --help             Show this help\n"
              << "\n"
              << "Examples:\n"
              << "  engine --server ws://localhost:3000 --play\n"
              << "  engine --server ws://localhost:3000 --play --project my-song\n"
              << "  engine --doc project.am --play\n"
              << "  engine --doc project.am --render output.wav\n"
              << std::endl;
}

struct Options {
    std::string doc_path;
    std::string output_path;
    std::string assets_dir;
    std::string device_name;
    std::string server_url;      // Server URL for live sync (e.g., ws://localhost:3000)
    std::string project_id = "default";  // Project ID for server sync
    bool play = false;
    bool render = false;
    bool info = false;
    bool mute = false;
    bool keepalive = false;  // File mode: loop the document instead of exiting at its end
    bool list_devices = false;
    uint32_t sample_rate = 48000;
    uint32_t bit_depth = 24;
    uint16_t ws_port = 47821;    // Changed default to 47821
    uint32_t debug_rebuild_delay_ms = 0;  // Test hook: simulate expensive graph builds
    std::string debug_proxy_module;  // 2.4c-1: --debug-proxy-again <AGain.vst3>
    std::string self_exe;            // argv[0], to locate the sibling plugin_host
    std::map<std::string, std::string> vst3_modules;  // c-2: uid -> module path
    std::vector<std::string> allow_origins;  // Extra allowed Origins for the WS server
    std::vector<std::string> solo_tracks;
    std::vector<std::string> mute_tracks;
};

bool parseArgs(int argc, char* argv[], Options& opts) {
    opts.self_exe = (argc >= 1 && argv[0]) ? argv[0] : "";
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if (arg == "--help" || arg == "-h") {
            printUsage(argv[0]);
            return false;
        } else if (arg == "--doc") {
            if (++i >= argc) {
                std::cerr << "Error: --doc requires a file path\n";
                return false;
            }
            opts.doc_path = argv[i];
        } else if (arg == "--play") {
            opts.play = true;
        } else if (arg == "--render") {
            if (++i >= argc) {
                std::cerr << "Error: --render requires an output path\n";
                return false;
            }
            opts.output_path = argv[i];
            opts.render = true;
        } else if (arg == "--assets") {
            if (++i >= argc) {
                std::cerr << "Error: --assets requires a directory path\n";
                return false;
            }
            opts.assets_dir = argv[i];
        } else if (arg == "--info") {
            opts.info = true;
        } else if (arg == "--sample-rate") {
            if (++i >= argc) {
                std::cerr << "Error: --sample-rate requires a value\n";
                return false;
            }
            opts.sample_rate = static_cast<uint32_t>(std::stoul(argv[i]));
        } else if (arg == "--bit-depth") {
            if (++i >= argc) {
                std::cerr << "Error: --bit-depth requires a value\n";
                return false;
            }
            opts.bit_depth = static_cast<uint32_t>(std::stoul(argv[i]));
        } else if (arg == "--keepalive") {
            opts.keepalive = true;
        } else if (arg == "--mute") {
            opts.mute = true;
        } else if (arg == "--ws-port") {
            if (++i >= argc) {
                std::cerr << "Error: --ws-port requires a value\n";
                return false;
            }
            opts.ws_port = static_cast<uint16_t>(std::stoul(argv[i]));
        } else if (arg == "--server") {
            if (++i >= argc) {
                std::cerr << "Error: --server requires a URL\n";
                return false;
            }
            opts.server_url = argv[i];
        } else if (arg == "--project") {
            if (++i >= argc) {
                std::cerr << "Error: --project requires an ID\n";
                return false;
            }
            opts.project_id = argv[i];
        } else if (arg == "--debug-rebuild-delay-ms") {
            // Test hook (burst/coalescing E2E): sleep inserted in the graph
            // builder, off the audio thread, to simulate expensive builds
            // (plugin instantiation). Without a cost, a 3-track build takes
            // microseconds and coalescing would be unobservable.
            if (++i >= argc) {
                std::cerr << "Error: --debug-rebuild-delay-ms requires a value\n";
                return false;
            }
            opts.debug_rebuild_delay_ms = static_cast<uint32_t>(std::stoul(argv[i]));
        } else if (arg == "--debug-proxy-again") {
            // 2.4c-1 test hook: hard-wired ProxyNode over AGain, BEFORE the
            // document's chain drives it (that lands in c-2)
            if (++i >= argc) {
                std::cerr << "Error: --debug-proxy-again requires a path to AGain .vst3\n";
                return false;
            }
            opts.debug_proxy_module = argv[i];
        } else if (arg == "--vst3-module") {
            // c-2: uid -> module resolution for "vst3" chain nodes. The
            // DOCUMENT carries uids only; paths are a host-side concern.
            // Repeatable: --vst3-module <hex32>=<path.vst3>
            if (++i >= argc) {
                std::cerr << "Error: --vst3-module requires <uid>=<path>\n";
                return false;
            }
            const std::string spec = argv[i];
            const auto eq = spec.find('=');
            if (eq == std::string::npos || eq == 0 || eq + 1 >= spec.size()) {
                std::cerr << "Error: --vst3-module expects <uid>=<path>, got: " << spec << "\n";
                return false;
            }
            opts.vst3_modules[spec.substr(0, eq)] = spec.substr(eq + 1);
        } else if (arg == "--allow-origin") {
            if (++i >= argc) {
                std::cerr << "Error: --allow-origin requires an origin\n";
                return false;
            }
            opts.allow_origins.push_back(argv[i]);
        } else if (arg == "--solo") {
            if (++i >= argc) {
                std::cerr << "Error: --solo requires a track ID\n";
                return false;
            }
            opts.solo_tracks.push_back(argv[i]);
        } else if (arg == "--mute-track") {
            if (++i >= argc) {
                std::cerr << "Error: --mute-track requires a track ID\n";
                return false;
            }
            opts.mute_tracks.push_back(argv[i]);
        } else if (arg == "--list-devices") {
            opts.list_devices = true;
        } else if (arg == "--device") {
            if (++i >= argc) {
                std::cerr << "Error: --device requires a device name\n";
                return false;
            }
            opts.device_name = argv[i];
        } else {
            std::cerr << "Error: Unknown option: " << arg << "\n";
            return false;
        }
    }

    // --list-devices doesn't require --doc
    if (opts.list_devices) {
        return true;
    }

    // Either --doc or --server is required
    if (opts.doc_path.empty() && opts.server_url.empty()) {
        std::cerr << "Error: --doc or --server is required\n";
        return false;
    }

    if (!opts.doc_path.empty() && !opts.server_url.empty()) {
        std::cerr << "Error: --doc and --server are mutually exclusive\n";
        return false;
    }

    if (!opts.play && !opts.render && !opts.info) {
        std::cerr << "Error: One of --play, --render, or --info is required\n";
        return false;
    }

    // --render and --info require --doc (can't render from live server)
    if ((opts.render || opts.info) && opts.doc_path.empty()) {
        std::cerr << "Error: --render and --info require --doc\n";
        return false;
    }

    // Default assets dir to document directory or current dir for server mode
    if (opts.assets_dir.empty()) {
        if (!opts.doc_path.empty()) {
            opts.assets_dir = fs::path(opts.doc_path).parent_path().string();
        }
        if (opts.assets_dir.empty()) {
            opts.assets_dir = ".";
        }
    }

    return true;
}

int doListDevices() {
    auto devices = daw::audio::listPlaybackDevices();

    std::cout << "Available audio devices:\n\n";

    for (size_t i = 0; i < devices.size(); ++i) {
        std::cout << "  " << (i + 1) << ". " << devices[i].name;
        if (devices[i].is_default) {
            std::cout << " (default)";
        }
        std::cout << "\n";
    }

    if (devices.empty()) {
        std::cout << "  No devices found.\n";
    }

    std::cout << "\nUse --device <name> to select a device by name.\n";
    return 0;
}

int showInfo(const daw::document::AutomergeDocument& doc) {
    const auto& project = doc.getDocument();

    std::cout << "Project Information:\n"
              << "  Schema Version: " << project.schema_version << "\n"
              << "  Sample Rate: " << project.sample_rate << " Hz\n"
              << "  Tracks: " << project.tracks.size() << "\n";

    for (size_t i = 0; i < project.tracks.size(); ++i) {
        const auto& track = project.tracks[i];
        std::cout << "\n  Track " << (i + 1) << ":\n"
                  << "    ID: " << track.id << "\n"
                  << "    Name: " << track.name << "\n"
                  << "    Gain: " << track.gain << "\n"
                  << "    Clips: " << track.clips.size() << "\n"
                  << "    Processors: " << track.chain.size() << "\n";

        for (const auto& clip : track.clips) {
            std::cout << "      Clip: " << clip.id << "\n"
                      << "        Asset: " << clip.asset_hash << "\n"
                      << "        Start: " << clip.start_sample << " samples\n"
                      << "        Length: " << clip.length_samples << " samples\n";
        }
    }

    // Calculate total length
    int64_t total_length = daw::render::OfflineRenderer::calculateProjectLength(doc);
    double duration_sec = static_cast<double>(total_length) / project.sample_rate;
    std::cout << "\n  Total Length: " << total_length << " samples ("
              << duration_sec << " seconds)\n";

    return 0;
}

/**
 * Build audio graph from project definition.
 *
 * @param project Project definition
 * @param sample_rate Sample rate
 * @param assets_dir Assets directory
 * @param asset_cache Asset cache (shared across rebuilds)
 * @return Audio graph, or nullptr on failure
 */
// 2.4c-1: registry key and AGain class uid for the hard-wired debug proxy.
// The uid is the SDK sample's stable audio-class id (verified by test 11).
constexpr const char* kDebugProxyNodeId = "debug-proxy-again";
constexpr const char* kAGainAudioUid = "84E8DE5F92554F5396FAE4133C935A18";

/**
 * Start the debug AGain child (--debug-proxy-again) into the registry.
 * Control thread, BEFORE the first buildGraph: the bridge lives in the
 * registry handle and survives every rebuild (ADR-017 - a burst of changes
 * re-attaches proxies, it never re-spawns the child).
 */
std::string hostExePath(const Options& opts) {
#ifdef _WIN32
    const char* host_name = "plugin_host.exe";
#else
    const char* host_name = "plugin_host";
#endif
    return (fs::path(opts.self_exe).parent_path() / host_name).string();
}

bool startDebugProxy(const Options& opts, uint32_t sample_rate,
                     daw::graph::PluginInstanceRegistry& plugin_registry) {
    if (opts.debug_proxy_module.empty()) {
        return true;
    }
    const std::string host_exe = hostExePath(opts);

    auto& handle = plugin_registry.ensure(kDebugProxyNodeId);
    handle.bridge = std::make_unique<daw::host::PluginBridge>();
    if (!handle.bridge->start(host_exe, opts.debug_proxy_module, kAGainAudioUid,
                              sample_rate)) {
        std::cerr << "Failed to start debug proxy child: "
                  << handle.bridge->error() << "\n";
        handle.bridge.reset();
        return false;
    }
    std::cout << "Debug proxy: AGain served out-of-process (" << host_exe << ")\n";
    return true;
}

/**
 * Control-loop poll (c-2), EVERY registry instance: child death is detected
 * HERE, on the control thread via the process handle - the audio callback
 * only ever sees "block not ready" and bypasses. Cold restart on the SAME
 * segment (ring seq and latest param survive), budget of 3 attempts per
 * instance, then permanent bypass - always signaled (stderr + EngineState).
 */
void pollPluginChildren(daw::graph::PluginInstanceRegistry& plugin_registry) {
    plugin_registry.forEach([](const std::string& node_id,
                               daw::graph::PluginInstanceHandle& handle) {
        if (!handle.bridge) return;
        if (handle.bridge->childAlive()) return;

        handle.child_alive.store(false, std::memory_order_relaxed);  // signal NOW
        const uint32_t attempts = handle.child_restarts.load(std::memory_order_relaxed);
        if (attempts >= 3) {
            if (attempts == 3) {  // log the exhaustion exactly once
                handle.child_restarts.store(4, std::memory_order_relaxed);
                std::cerr << "\nPlugin child dead (" << node_id
                          << "), restart budget exhausted - permanent bypass\n";
            }
            return;
        }
        handle.child_restarts.store(attempts + 1, std::memory_order_relaxed);
        std::cerr << "\nPlugin child died (" << node_id << ") - cold restart (attempt "
                  << (attempts + 1) << "/3)\n";
        if (handle.bridge->restartChild()) {
            handle.child_alive.store(true, std::memory_order_relaxed);
            std::cerr << "Plugin child restarted (ring state preserved)\n";
        } else {
            std::cerr << "Plugin child restart failed: " << handle.bridge->error() << "\n";
        }
    });
}

/**
 * c-2: ensure the out-of-process instance for a document vst3 node exists.
 * The registry keys by NODE id: rebuilds re-attach, never re-spawn.
 */
daw::graph::PluginInstanceHandle* ensureVst3Child(
    daw::graph::PluginInstanceRegistry& plugin_registry,
    const std::string& node_id, const std::string& uid,
    const Options& opts, uint32_t sample_rate) {
    auto& handle = plugin_registry.ensure(node_id);
    if (handle.bridge && handle.bridge->isRunning()) {
        return &handle;
    }
    const auto it = opts.vst3_modules.find(uid);
    if (it == opts.vst3_modules.end()) {
        static std::set<std::string> warned;
        if (warned.insert(uid).second) {
            std::cerr << "Chain node " << node_id << ": no --vst3-module mapping for uid "
                      << uid << " - node SKIPPED (signaled once)\n";
        }
        return nullptr;
    }
    handle.bridge = std::make_unique<daw::host::PluginBridge>();
    if (!handle.bridge->start(hostExePath(opts), it->second, uid, sample_rate)) {
        std::cerr << "Chain node " << node_id << ": plugin child failed: "
                  << handle.bridge->error() << "\n";
        handle.bridge.reset();
        return nullptr;
    }
    std::cout << "Chain node " << node_id << ": " << uid
              << " served out-of-process\n";
    return &handle;
}

/**
 * Point EngineState telemetry at a plugin instance's counters: the debug
 * proxy if present, else the first document-driven instance. ONE instance
 * for the thin slice; aggregation is a dated debt for the multi-plugin day.
 * Idempotent - safe to re-call as instances appear.
 */
void wirePluginTelemetry(daw::websocket::WebSocketServer& ws_server,
                         daw::graph::PluginInstanceRegistry& plugin_registry) {
    daw::graph::PluginInstanceHandle* chosen = plugin_registry.find(kDebugProxyNodeId);
    if (!chosen || !chosen->bridge) {
        chosen = nullptr;
        plugin_registry.forEach([&](const std::string&,
                                    daw::graph::PluginInstanceHandle& handle) {
            if (!chosen && handle.bridge) chosen = &handle;
        });
    }
    // V1.5: ALWAYS set (nullptr clears). Eviction can destroy the handle
    // telemetry pointed at; leaving the old pointers in place would be a
    // dangling read on the next broadcast. nullptr is the wire's rest state.
    ws_server.setPluginBlocksMissed(chosen ? &chosen->blocks_missed : nullptr);
    ws_server.setPluginChildState(chosen ? &chosen->child_alive : nullptr,
                                  chosen ? &chosen->child_restarts : nullptr);
}

/**
 * 2.3b: fetch a missing asset from the server's content-addressed store
 * (the HTTP side of the triangle). Control thread, during buildGraph.
 * A sha256-keyed body is VERIFIED before it touches the assets dir
 * (legacy 16-char keys cannot be, accepted with a log). Failures are
 * remembered for the session - a burst of rebuilds must not become a
 * storm of GETs (dated debt: retry when the asset later appears).
 */
bool fetchAssetFromServer(const std::string& server_ws_url,
                          const std::string& hash,
                          const std::string& assets_dir) {
    static std::set<std::string> failed_this_session;
    if (server_ws_url.empty() || hash.empty() ||
        failed_this_session.count(hash) > 0) {
        return false;
    }

    // ws://host:port -> http://host:port (wss -> https)
    std::string http_base = server_ws_url;
    if (http_base.rfind("wss://", 0) == 0) {
        http_base = "https://" + http_base.substr(6);
    } else if (http_base.rfind("ws://", 0) == 0) {
        http_base = "http://" + http_base.substr(5);
    }
    const std::string url = http_base + "/assets/" + hash;

    ix::HttpClient http;
    ix::HttpRequestArgsPtr args = http.createRequest();
    args->connectTimeout = 10;
    args->transferTimeout = 120;
    ix::HttpResponsePtr response = http.get(url, args);
    if (!response || response->statusCode != 200) {
        std::cerr << "Asset " << hash << ": not on server ("
                  << (response ? response->statusCode : 0) << ")\n";
        failed_this_session.insert(hash);
        return false;
    }
    if (hash.size() == 64 &&
        daw::util::sha256Hex(response->body.data(), response->body.size()) != hash) {
        std::cerr << "Asset " << hash << ": server body does not match its hash - REFUSED\n";
        failed_this_session.insert(hash);
        return false;
    }

    // Atomic write: temp + rename (the store mold)
    std::error_code ec;
    fs::create_directories(assets_dir, ec);
    const fs::path final_path = fs::path(assets_dir) / (hash + ".wav");
    const fs::path tmp_path = fs::path(assets_dir) / (hash + ".wav.tmp");
    {
        std::ofstream out(tmp_path, std::ios::binary | std::ios::trunc);
        out.write(response->body.data(),
                  static_cast<std::streamsize>(response->body.size()));
        if (!out.good()) {
            std::cerr << "Asset " << hash << ": local write failed\n";
            fs::remove(tmp_path, ec);
            failed_this_session.insert(hash);
            return false;
        }
    }
    fs::rename(tmp_path, final_path, ec);
    if (ec) {
        fs::remove(tmp_path, ec);
        failed_this_session.insert(hash);
        return false;
    }
    std::cout << "Asset fetched from server: " << hash << " ("
              << response->body.size() << " bytes)\n";
    return true;
}

std::unique_ptr<daw::graph::AudioGraph> buildGraph(
    const daw::document::ProjectDef& project,
    uint32_t sample_rate,
    const std::string& assets_dir,
    daw::graph::AssetCache& asset_cache,
    daw::graph::PluginInstanceRegistry& plugin_registry,
    const Options& opts,
    uint32_t proxy_depth = 1  // blocks per device callback (buffer/256)
) {
    auto graph = std::make_unique<daw::graph::AudioGraph>();
    graph->setSampleRate(sample_rate);
    graph->setMasterGain(project.master_gain);  // V1.2

    for (const auto& track_def : project.tracks) {
        daw::graph::AudioTrack track;
        track.id = track_def.id;
        track.name = track_def.name;
        track.gain.store(track_def.gain, std::memory_order_relaxed);

        // Load clips. Server mode: on a local miss, pull from the store
        // (2.3b) so the file exists on disk BEFORE the shared builder
        // runs - then both live and offline paths call the identical
        // makeClipPlayer (S3: the clip-geometry twin lives in one place).
        for (const auto& clip_def : track_def.clips) {
            if (!opts.server_url.empty()) {
                const std::string asset_path =
                    assets_dir + "/" + clip_def.asset_hash + ".wav";
                if (!asset_cache.loadOrGet(asset_path)) {
                    fetchAssetFromServer(opts.server_url, clip_def.asset_hash, assets_dir);
                }
            }
            track.clips.push_back(
                daw::graph::makeClipPlayer(clip_def, assets_dir, asset_cache,
                                           sample_rate));
        }

        // Create processors
        for (const auto& proc_def : track_def.chain) {
            if (proc_def.type == daw::graph::GainNode::TYPE) {
                if (proc_def.bypass) continue;  // zero-latency node: bypass = omission
                track.chain.push_back(daw::graph::makeGainNode(proc_def));  // S3 shared
            } else if (proc_def.type == "vst3") {
                // c-2: ProxyNode from the DOCUMENT (uid on the node). The
                // registry hands the same ring to every rebuild.
                auto* handle = ensureVst3Child(plugin_registry, proc_def.id,
                                               proc_def.uid, opts, sample_rate);
                if (handle) {
                    // Latest wins + the ring survives rebuilds: re-sending
                    // the document's params on every rebuild is idempotent,
                    // and it IS the param path (fader -> change -> rebuild)
                    for (const auto& [key, value] : proc_def.params) {
                        try {
                            handle->bridge->setParam(
                                static_cast<uint32_t>(std::stoul(key)), value);
                        } catch (const std::exception&) {
                            std::cerr << "Chain node " << proc_def.id
                                      << ": bad vst3 param key '" << key << "' (ignored)\n";
                        }
                    }
                    // bypass rides the document into the node: the child
                    // stays warm, the dry path keeps the same latency, and
                    // the toggle is just another rebuild
                    track.chain.push_back(std::make_unique<daw::host::ProxyNode>(
                        proc_def.id, handle->bridge->ring(), &handle->blocks_missed,
                        proxy_depth, proc_def.bypass));
                }
            } else {
                // AUDIT R5: never silently drop - a peer hearing a
                // different mix is a collaboration bug, not a fallback
                static std::set<std::string> warned;
                if (warned.insert(proc_def.type).second) {
                    std::cerr << "Chain: UNKNOWN node type '" << proc_def.type
                              << "' (node " << proc_def.id
                              << ") - node skipped, signaled once\n";
                }
            }
        }

        graph->addTrack(std::move(track));
    }

    // 2.4c-1: hard-wired debug proxy on the FIRST track (the chain-driven
    // path lands in c-2). The registry hands the SAME ring to every rebuild:
    // a ProxyNode is 3 pointers, the child is never re-instantiated.
    if (auto* handle = plugin_registry.find(kDebugProxyNodeId);
        handle && handle->bridge && handle->bridge->isRunning() &&
        graph->getTrackCount() > 0) {
        graph->getTrack(0)->chain.push_back(std::make_unique<daw::host::ProxyNode>(
            kDebugProxyNodeId, handle->bridge->ring(), &handle->blocks_missed,
            proxy_depth));
    }

    return graph;
}

/**
 * Copy solo/mute state from old graph to new graph.
 */
void copyMonitorState(daw::graph::AudioGraph* from, daw::graph::AudioGraph* to) {
    if (!from || !to) return;

    for (size_t i = 0; i < from->getTrackCount(); ++i) {
        auto* old_track = from->getTrack(i);
        if (!old_track) continue;

        auto* new_track = to->getTrackById(old_track->id);
        if (new_track) {
            new_track->solo.store(old_track->solo.load(std::memory_order_relaxed),
                                  std::memory_order_relaxed);
            new_track->mute.store(old_track->mute.load(std::memory_order_relaxed),
                                  std::memory_order_relaxed);
        }
    }
}

int doRender(const daw::document::AutomergeDocument& doc, const Options& opts) {
    std::cout << "Rendering to: " << opts.output_path << "\n";

    daw::render::RenderConfig config;
    config.sample_rate = opts.sample_rate;
    config.bit_depth = opts.bit_depth;

    daw::render::OfflineRenderer renderer;
    if (!opts.vst3_modules.empty()) {
        renderer.setVst3Modules(opts.vst3_modules, hostExePath(opts));
    }

    auto progress = [](int64_t current, int64_t total) -> bool {
        int percent = static_cast<int>((current * 100) / total);
        std::cout << "\rProgress: " << percent << "%" << std::flush;
        return g_running.load();
    };

    auto result = renderer.render(doc, opts.output_path, opts.assets_dir, config, progress);

    std::cout << "\n";

    if (!result.success) {
        std::cerr << "Render failed: " << result.error << "\n";
        return 1;
    }

    std::cout << "Render complete:\n"
              << "  Samples: " << result.samples_rendered << "\n"
              << "  Peak L: " << result.peak_left << "\n"
              << "  Peak R: " << result.peak_right << "\n"
              << "  Clipped: " << (result.clipped ? "yes" : "no") << "\n";

    return 0;
}

int doPlay(const daw::document::AutomergeDocument& doc, const Options& opts) {
    std::cout << "Playing project...\n";
    std::cout << "Press Ctrl+C to stop.\n\n";

    // Set up signal handler
    std::signal(SIGINT, signalHandler);

    // Initialize audio device
    daw::audio::AudioDevice device;
    daw::audio::AudioDeviceConfig config;
    config.sample_rate = opts.sample_rate;
    config.buffer_size_frames = 512;
    config.use_null_backend = opts.mute;
    config.device_name = opts.device_name;

    if (!device.initialize(config)) {
        std::cerr << "Failed to initialize audio device\n";
        return 1;
    }

    std::cout << "Audio Device: " << device.getDeviceName() << "\n"
              << "Sample Rate: " << device.getSampleRate() << " Hz\n"
              << "Buffer Size: " << device.getBufferSize() << " frames\n\n";

    // Build audio graph (shared ownership: audio thread and telemetry
    // readers acquire copies from the device's atomic slot)
    daw::graph::AssetCache asset_cache;
    daw::graph::PluginInstanceRegistry plugin_registry;
    if (!startDebugProxy(opts, device.getSampleRate(), plugin_registry)) {
        return 1;
    }
    const auto& project = doc.getDocument();

    const uint32_t proxy_depth =
        (std::max)(1u, device.getBufferSize() / daw::host::kRingBlockSize);
    std::shared_ptr<daw::graph::AudioGraph> graph =
        buildGraph(project, device.getSampleRate(), opts.assets_dir,
                   asset_cache, plugin_registry, opts, proxy_depth);
    if (!graph) {
        std::cerr << "Failed to build audio graph\n";
        return 1;
    }

    graph->prepare(device.getSampleRate(), device.getBufferSize());
    std::cout << "Built graph with " << graph->getTrackCount() << " tracks\n";

    // Apply initial solo/mute from CLI
    for (const auto& track_id : opts.solo_tracks) {
        auto* track = graph->getTrackById(track_id);
        if (track) {
            track->solo.store(true, std::memory_order_relaxed);
            std::cout << "Solo: " << track_id << "\n";
        } else {
            std::cerr << "Warning: Track not found for solo: " << track_id << "\n";
        }
    }
    for (const auto& track_id : opts.mute_tracks) {
        auto* track = graph->getTrackById(track_id);
        if (track) {
            track->mute.store(true, std::memory_order_relaxed);
            std::cout << "Mute: " << track_id << "\n";
        } else {
            std::cerr << "Warning: Track not found for mute: " << track_id << "\n";
        }
    }

    // Set active graph and start playback
    device.setActiveGraph(graph);

    // Start WebSocket server
    daw::websocket::WebSocketServer ws_server;
    daw::websocket::WebSocketConfig ws_config;
    ws_config.port = opts.ws_port;
    ws_config.bind_address = "127.0.0.1";
    ws_config.telemetry_hz = 30;
    ws_config.allowed_origins.insert(ws_config.allowed_origins.end(),
                                     opts.allow_origins.begin(), opts.allow_origins.end());

    wirePluginTelemetry(ws_server, plugin_registry);
    if (ws_server.start(ws_config, &device, device.getActiveGraphSlot())) {
        std::cout << "WebSocket server: ws://127.0.0.1:" << opts.ws_port << "\n\n";
    } else {
        std::cerr << "Warning: Failed to start WebSocket server\n";
    }

    if (!device.start()) {
        std::cerr << "Failed to start audio device\n";
        return 1;
    }

    // Calculate total length
    int64_t total_length = daw::render::OfflineRenderer::calculateProjectLength(doc);

    // V1.1: loop braces = the content; the CALLBACK owns wrap and
    // end-stop now (single writer of position_ during playback).
    // --keepalive simply plays looped forever.
    device.getTransport().setLoopPoints(0, total_length);
    if (opts.keepalive) {
        device.getTransport().setLooping(true);
    }

    // Start transport
    device.getTransport().play();

    // Telemetry timing
    auto last_telemetry = std::chrono::steady_clock::now();
    const auto telemetry_interval = std::chrono::milliseconds(1000 / ws_config.telemetry_hz);

    // Main loop
    while (g_running) {
        auto now = std::chrono::steady_clock::now();

        // Broadcast telemetry at configured rate
        if (now - last_telemetry >= telemetry_interval) {
            pollPluginChildren(plugin_registry);
            if (ws_server.isRunning()) {
                wirePluginTelemetry(ws_server, plugin_registry);
                ws_server.broadcastTelemetry();
            }
            last_telemetry = now;
        }

        // Poll telemetry for CLI display
        while (auto telemetry = device.pollTelemetry()) {
            double position_sec = static_cast<double>(telemetry->position_samples) / device.getSampleRate();
            double total_sec = static_cast<double>(total_length) / device.getSampleRate();

            std::cout << "\rPosition: " << position_sec << " / " << total_sec << " s"
                      << " | Peak L: " << telemetry->peak_left
                      << " R: " << telemetry->peak_right
                      << " | Underruns: " << telemetry->buffer_underruns
                      << "    " << std::flush;

            // V1.1: the callback stops the transport at end of content
            // (no loop); the CLI exits when it SEES that stop at the
            // end. A manual browser STOP mid-piece keeps the process
            // alive (position < end). The control thread never writes
            // position_ anymore - the callback is its single writer.
            if (!telemetry->is_playing &&
                telemetry->position_samples >= total_length &&
                total_length > 0) {
                g_running = false;
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    std::cout << "\n\nStopping...\n";

    // Stop WebSocket server
    ws_server.stop();

    device.getTransport().stop();
    device.stop();
    device.shutdown();

    std::cout << "Done. Buffer underruns: " << device.getBufferUnderrunCount() << "\n";
    if (auto* handle = plugin_registry.find(kDebugProxyNodeId); handle && handle->bridge) {
        std::cout << "Bridge blocks missed: "
                  << handle->blocks_missed.load(std::memory_order_relaxed)
                  << (handle->bridge->childAlive() ? " (child alive)" : " (child DEAD)")
                  << "\n";
    }

    return 0;
}

int doPlayWithServer(const Options& opts) {
    std::cout << "Connecting to server: " << opts.server_url << "\n";
    std::cout << "Project: " << opts.project_id << "\n";
    std::cout << "Press Ctrl+C to stop.\n\n";

    // Set up signal handler
    std::signal(SIGINT, signalHandler);

    // Initialize audio device
    daw::audio::AudioDevice device;
    daw::audio::AudioDeviceConfig config;
    config.sample_rate = opts.sample_rate;
    config.buffer_size_frames = 512;
    config.use_null_backend = opts.mute;
    config.device_name = opts.device_name;

    if (!device.initialize(config)) {
        std::cerr << "Failed to initialize audio device\n";
        return 1;
    }

    std::cout << "Audio Device: " << device.getDeviceName() << "\n"
              << "Sample Rate: " << device.getSampleRate() << " Hz\n"
              << "Buffer Size: " << device.getBufferSize() << " frames\n\n";

    // Document: written by the network thread (load/apply under doc_mutex),
    // snapshotted by the builder in the main loop. The builder NEVER reads
    // the live document: it copies a ProjectDef under the lock and builds
    // outside it - same mold as the server-side ordering fixes, engine side.
    daw::document::AutomergeDocument doc;
    std::mutex doc_mutex;

    // Monotonic document version: +1 per applied change or (re)load.
    // LAST STATE WINS: the builder rebuilds once toward the newest version;
    // intermediates arriving during a build coalesce and are never audible.
    std::atomic<uint64_t> doc_version{0};

    daw::graph::AssetCache asset_cache;
    daw::graph::PluginInstanceRegistry plugin_registry;  // ADR-017 (R2)
    if (!startDebugProxy(opts, device.getSampleRate(), plugin_registry)) {
        return 1;
    }

    // Main-thread-only state: the builder lives in the main loop (R1 -
    // construction is OFF the network thread), so no graph mutex is needed.
    std::shared_ptr<daw::graph::AudioGraph> current_graph;
    std::vector<daw::audio::AudioDevice::RetiredGraph> retired_graphs;
    uint64_t last_built_version = 0;
    bool playback_started = false;

    // V1.5 / A4-5: eviction is STAGED at rebuild and EXECUTED only once
    // the retirement queue is empty - a retired graph's ProxyNode still
    // reads the bridge ring until the generation gate proves release, so
    // destroying the bridge earlier would be a use-after-free. Overwritten
    // by every rebuild (last state wins, like the builder itself).
    std::set<std::string> eviction_keep;
    bool eviction_pending = false;

    // Connect to sync server
    daw::network::ServerClient server_client;
    daw::network::ServerConfig server_config;
    server_config.url = opts.server_url;
    server_config.project_id = opts.project_id;

    // Handle initial document. NETWORK THREAD: document work only, no
    // graph construction here (R1) - bump the version, the builder follows.
    server_client.setDocumentCallback([&](const std::vector<uint8_t>& data) {
        std::cout << "Received initial document (" << data.size() << " bytes)\n";
        {
            std::lock_guard<std::mutex> lock(doc_mutex);
            if (!doc.loadFromBytes(data.data(), data.size())) {
                std::cerr << "Failed to load document: " << doc.getLastError() << "\n";
                return;
            }
            std::cout << "Document loaded: " << doc.getDocument().tracks.size() << " tracks\n";
        }
        doc_version.fetch_add(1, std::memory_order_release);
    });

    // Handle document changes. NETWORK THREAD: apply + version bump only.
    server_client.setChangeCallback([&](const std::vector<uint8_t>& change) {
        {
            std::lock_guard<std::mutex> lock(doc_mutex);
            if (!doc.applyChange(change.data(), change.size())) {
                std::cerr << "Failed to apply change: " << doc.getLastError() << "\n";
                return;
            }
        }
        doc_version.fetch_add(1, std::memory_order_release);
    });

    // Connect to server
    if (!server_client.connect(server_config)) {
        std::cerr << "Failed to connect to server\n";
        return 1;
    }

    // Start WebSocket server for browser communication (telemetry)
    daw::websocket::WebSocketServer ws_server;
    daw::websocket::WebSocketConfig ws_config;
    ws_config.port = opts.ws_port;
    ws_config.bind_address = "127.0.0.1";
    ws_config.telemetry_hz = 30;
    ws_config.allowed_origins.insert(ws_config.allowed_origins.end(),
                                     opts.allow_origins.begin(), opts.allow_origins.end());
    wirePluginTelemetry(ws_server, plugin_registry);

    // Telemetry timing
    auto last_telemetry = std::chrono::steady_clock::now();
    const auto telemetry_interval = std::chrono::milliseconds(1000 / ws_config.telemetry_hz);

    // Main loop
    while (g_running) {
        auto now = std::chrono::steady_clock::now();

        // ---- Graph builder (R1). Runs here, never on the network thread.
        // Last state wins: one rebuild toward the newest document version;
        // anything that arrived during the build is caught by the next tick.
        const uint64_t target_version = doc_version.load(std::memory_order_acquire);
        if (target_version != 0 && target_version != last_built_version) {
            daw::document::ProjectDef snapshot;
            {
                // The snapshot IS the deep copy; the build below never
                // touches the live document
                std::lock_guard<std::mutex> lock(doc_mutex);
                snapshot = doc.getDocument();
            }

            auto graph = buildGraph(
                snapshot, device.getSampleRate(), opts.assets_dir, asset_cache,
                plugin_registry, opts,
                (std::max)(1u, device.getBufferSize() / daw::host::kRingBlockSize));
            if (graph) {
                if (opts.debug_rebuild_delay_ms > 0) {
                    // Test hook: simulate an expensive (plugin) build
                    std::this_thread::sleep_for(
                        std::chrono::milliseconds(opts.debug_rebuild_delay_ms));
                }
                graph->prepare(device.getSampleRate(), device.getBufferSize());

                if (!playback_started) {
                    // First graph: apply CLI solo/mute
                    for (const auto& track_id : opts.solo_tracks) {
                        auto* track = graph->getTrackById(track_id);
                        if (track) track->solo.store(true, std::memory_order_relaxed);
                    }
                    for (const auto& track_id : opts.mute_tracks) {
                        auto* track = graph->getTrackById(track_id);
                        if (track) track->mute.store(true, std::memory_order_relaxed);
                    }
                } else {
                    copyMonitorState(current_graph.get(), graph.get());
                }

                std::shared_ptr<daw::graph::AudioGraph> shared_graph = std::move(graph);
                auto retired = device.setActiveGraph(shared_graph);
                current_graph = std::move(shared_graph);
                if (retired.graph) {
                    retired_graphs.push_back(std::move(retired));
                }
                last_built_version = target_version;

                // V1.1: refresh the loop braces to the new content
                // (loop start fixed at 0; the callback wraps/stops on
                // these atomics - empty project => end 0, guarded there)
                int64_t content_end = 0;
                for (const auto& t : snapshot.tracks) {
                    for (const auto& c : t.clips) {
                        content_end = (std::max)(
                            content_end, c.start_sample + c.length_samples);
                    }
                }
                device.getTransport().setLoopPoints(0, content_end);

                // V1.5 / A4-5: stage eviction of children whose node id
                // left the document (executed below, once retirement-safe).
                eviction_keep.clear();
                eviction_keep.insert(kDebugProxyNodeId);
                for (const auto& t : snapshot.tracks) {
                    for (const auto& p : t.chain) {
                        if (p.type == "vst3") eviction_keep.insert(p.id);
                    }
                }
                eviction_pending = true;

                if (!playback_started) {
                    playback_started = true;
                    if (device.getState() != daw::audio::AudioDeviceState::Running) {
                        if (device.start()) {
                            device.getTransport().play();
                            std::cout << "Playback started\n";
                        } else {
                            std::cerr << "Failed to start audio device\n";
                        }
                    }
                }

                std::cout << "Graph updated (document change, v=" << target_version << ")\n";
            } else {
                std::cerr << "Failed to build audio graph\n";
                last_built_version = target_version;  // don't spin on a broken doc
            }
        }

        // Start WebSocket server once we have a graph
        if (!ws_server.isRunning() && current_graph) {
            if (ws_server.start(ws_config, &device, device.getActiveGraphSlot())) {
                std::cout << "WebSocket server: ws://127.0.0.1:" << opts.ws_port << "\n";
            }
        }

        // Destroy retired graphs the audio callback provably released
        // (generation gate) and that no control-side reader still holds
        // (use_count()==1: only the retirement queue references it).
        retired_graphs.erase(
            std::remove_if(retired_graphs.begin(), retired_graphs.end(),
                           [&device](const daw::audio::AudioDevice::RetiredGraph& r) {
                               return device.isRetireSafe(r) && r.graph.use_count() == 1;
                           }),
            retired_graphs.end());

        // V1.5 / A4-5: the staged eviction fires once NO retired graph can
        // still touch a bridge ring. Telemetry is re-wired IMMEDIATELY (the
        // evicted handle may be the one it pointed at).
        if (eviction_pending && retired_graphs.empty()) {
            const std::size_t evicted = plugin_registry.evictMissing(
                [&](const std::string& id) { return eviction_keep.count(id) > 0; });
            eviction_pending = false;
            if (evicted > 0) {
                wirePluginTelemetry(ws_server, plugin_registry);
                std::cout << "Evicted " << evicted
                          << " plugin child(ren) removed from the document\n";
            }
        }

        // Broadcast telemetry at configured rate
        if (now - last_telemetry >= telemetry_interval) {
            pollPluginChildren(plugin_registry);
            if (ws_server.isRunning()) {
                wirePluginTelemetry(ws_server, plugin_registry);
                ws_server.broadcastTelemetry();
            }
            last_telemetry = now;
        }

        // Poll telemetry for CLI display (reduced frequency to avoid buffer issues)
        static auto last_cli_output = std::chrono::steady_clock::now();
        const auto cli_interval = std::chrono::milliseconds(500);  // Output every 500ms

        while (auto telemetry = device.pollTelemetry()) {
            if (now - last_cli_output >= cli_interval) {
                double position_sec = static_cast<double>(telemetry->position_samples) / device.getSampleRate();
                std::cout << "\rPosition: " << position_sec << " s"
                          << " | Peak L: " << telemetry->peak_left
                          << " R: " << telemetry->peak_right
                          << " | Underruns: " << telemetry->buffer_underruns
                          << "    " << std::flush;
                last_cli_output = now;
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    std::cout << "\n\nStopping...\n";

    // Cleanup
    ws_server.stop();
    server_client.disconnect();
    device.getTransport().stop();
    device.stop();
    device.shutdown();

    // All readers are stopped: retired graphs can be destroyed unconditionally.
    retired_graphs.clear();

    std::cout << "Done. Buffer underruns: " << device.getBufferUnderrunCount() << "\n";
    if (auto* handle = plugin_registry.find(kDebugProxyNodeId); handle && handle->bridge) {
        std::cout << "Bridge blocks missed: "
                  << handle->blocks_missed.load(std::memory_order_relaxed)
                  << (handle->bridge->childAlive() ? " (child alive)" : " (child DEAD)")
                  << "\n";
    }

    return 0;
}

int main(int argc, char* argv[]) {
    Options opts;
    if (!parseArgs(argc, argv, opts)) {
        return 1;
    }

    // List devices mode
    if (opts.list_devices) {
        return doListDevices();
    }

    // Server mode - connect to sync server
    if (!opts.server_url.empty() && opts.play) {
        return doPlayWithServer(opts);
    }

    // File mode - load document from file
    daw::document::AutomergeDocument doc;
    if (!doc.loadFromFile(opts.doc_path)) {
        std::cerr << "Failed to load document: " << doc.getLastError() << "\n";
        return 1;
    }

    std::cout << "Loaded: " << opts.doc_path << "\n\n";

    if (opts.info) {
        return showInfo(doc);
    }

    if (opts.render) {
        return doRender(doc, opts);
    }

    if (opts.play) {
        return doPlay(doc, opts);
    }

    return 0;
}
