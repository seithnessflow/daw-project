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
#include "render/offline_render.h"
#include "websocket/websocket_server.h"

#include <chrono>
#include <cstring>
#include <filesystem>
#include <iostream>
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
              << "  " << program << " --doc <file.am> --play [--assets <dir>] [--ws-port <port>]\n"
              << "  " << program << " --doc <file.am> --render <output.wav> [--assets <dir>]\n"
              << "  " << program << " --doc <file.am> --info\n"
              << "  " << program << " --help\n"
              << "\n"
              << "Options:\n"
              << "  --doc <file>       Project document file (Automerge binary .am)\n"
              << "  --play             Play the project through audio device\n"
              << "  --render <file>    Render to WAV file\n"
              << "  --assets <dir>     Directory containing audio assets (default: same as doc)\n"
              << "  --info             Show project information\n"
              << "  --mute             Use null audio backend (silent playback for testing)\n"
              << "  --sample-rate <n>  Sample rate for rendering (default: 48000)\n"
              << "  --bit-depth <n>    Bit depth for rendering (16, 24, 32; default: 24)\n"
              << "  --ws-port <n>      WebSocket server port (default: 9000)\n"
              << "  --solo <track-id>  Solo specified track (can be used multiple times)\n"
              << "  --mute-track <id>  Mute specified track (can be used multiple times)\n"
              << "  --list-devices     List available audio devices and exit\n"
              << "  --device <name>    Select audio device by name (substring match)\n"
              << "  --help             Show this help\n"
              << "\n"
              << "Examples:\n"
              << "  engine --doc project.am --play\n"
              << "  engine --doc project.am --play --ws-port 9001\n"
              << "  engine --doc project.am --play --solo track-1\n"
              << "  engine --doc project.am --render output.wav\n"
              << "  engine --doc fixtures/two-tracks.am --render out.wav --assets fixtures\n"
              << std::endl;
}

struct Options {
    std::string doc_path;
    std::string output_path;
    std::string assets_dir;
    std::string device_name;
    bool play = false;
    bool render = false;
    bool info = false;
    bool mute = false;
    bool list_devices = false;
    uint32_t sample_rate = 48000;
    uint32_t bit_depth = 24;
    uint16_t ws_port = 9000;
    std::vector<std::string> solo_tracks;
    std::vector<std::string> mute_tracks;
};

bool parseArgs(int argc, char* argv[], Options& opts) {
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
        } else if (arg == "--mute") {
            opts.mute = true;
        } else if (arg == "--ws-port") {
            if (++i >= argc) {
                std::cerr << "Error: --ws-port requires a value\n";
                return false;
            }
            opts.ws_port = static_cast<uint16_t>(std::stoul(argv[i]));
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

    if (opts.doc_path.empty()) {
        std::cerr << "Error: --doc is required\n";
        return false;
    }

    if (!opts.play && !opts.render && !opts.info) {
        std::cerr << "Error: One of --play, --render, or --info is required\n";
        return false;
    }

    // Default assets dir to document directory
    if (opts.assets_dir.empty()) {
        opts.assets_dir = fs::path(opts.doc_path).parent_path().string();
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

int doRender(const daw::document::AutomergeDocument& doc, const Options& opts) {
    std::cout << "Rendering to: " << opts.output_path << "\n";

    daw::render::RenderConfig config;
    config.sample_rate = opts.sample_rate;
    config.bit_depth = opts.bit_depth;

    daw::render::OfflineRenderer renderer;

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

    // Build audio graph
    daw::graph::AssetCache asset_cache;
    const auto& project = doc.getDocument();

    auto graph = std::make_unique<daw::graph::AudioGraph>();
    graph->setSampleRate(device.getSampleRate());

    for (const auto& track_def : project.tracks) {
        daw::graph::AudioTrack track;
        track.id = track_def.id;
        track.name = track_def.name;
        track.gain = track_def.gain;

        // Load clips
        for (const auto& clip_def : track_def.clips) {
            daw::graph::ClipPlayer player;

            daw::graph::ClipInfo info;
            info.id = clip_def.id;
            info.asset_hash = clip_def.asset_hash;
            info.start_sample = clip_def.start_sample;
            info.length_samples = clip_def.length_samples;
            info.offset_samples = clip_def.offset_samples;
            player.setClip(info);

            // Try to load asset
            std::string asset_path = opts.assets_dir + "/" + clip_def.asset_hash + ".wav";
            const daw::graph::AudioAsset* asset = asset_cache.loadOrGet(asset_path);
            if (asset) {
                player.setAsset(asset);
                std::cout << "Loaded asset: " << asset_path << "\n";
            } else {
                std::cerr << "Warning: Could not load asset: " << asset_path << "\n";
            }

            track.clips.push_back(std::move(player));
        }

        // Create processors
        for (const auto& proc_def : track_def.chain) {
            if (proc_def.type == daw::graph::GainNode::TYPE) {
                float gain = 1.0f;
                auto it = proc_def.params.find("gain");
                if (it != proc_def.params.end()) {
                    gain = it->second;
                }
                auto node = std::make_unique<daw::graph::GainNode>(proc_def.id, gain);
                track.chain.push_back(std::move(node));
            }
        }

        graph->addTrack(std::move(track));
    }

    graph->prepare(device.getSampleRate(), device.getBufferSize());

    // Apply initial solo/mute from CLI
    for (const auto& track_id : opts.solo_tracks) {
        auto* track = graph->getTrackById(track_id);
        if (track) {
            track->solo = true;
            std::cout << "Solo: " << track_id << "\n";
        } else {
            std::cerr << "Warning: Track not found for solo: " << track_id << "\n";
        }
    }
    for (const auto& track_id : opts.mute_tracks) {
        auto* track = graph->getTrackById(track_id);
        if (track) {
            track->mute = true;
            std::cout << "Mute: " << track_id << "\n";
        } else {
            std::cerr << "Warning: Track not found for mute: " << track_id << "\n";
        }
    }

    // Set active graph and start playback
    device.setActiveGraph(graph.get());

    // Start WebSocket server
    daw::websocket::WebSocketServer ws_server;
    daw::websocket::WebSocketConfig ws_config;
    ws_config.port = opts.ws_port;
    ws_config.bind_address = "127.0.0.1";
    ws_config.telemetry_hz = 30;

    if (ws_server.start(ws_config, &device, graph.get())) {
        std::cout << "WebSocket server: ws://127.0.0.1:" << opts.ws_port << "\n\n";
    } else {
        std::cerr << "Warning: Failed to start WebSocket server\n";
    }

    if (!device.start()) {
        std::cerr << "Failed to start audio device\n";
        return 1;
    }

    // Start transport
    device.getTransport().play();

    // Calculate total length
    int64_t total_length = daw::render::OfflineRenderer::calculateProjectLength(doc);

    // Telemetry timing
    auto last_telemetry = std::chrono::steady_clock::now();
    const auto telemetry_interval = std::chrono::milliseconds(1000 / ws_config.telemetry_hz);

    // Main loop
    while (g_running) {
        auto now = std::chrono::steady_clock::now();

        // Broadcast telemetry at configured rate
        if (now - last_telemetry >= telemetry_interval) {
            if (ws_server.isRunning()) {
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

            // Stop if we've reached the end
            if (telemetry->position_samples >= total_length) {
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

    return 0;
}

int main(int argc, char* argv[]) {
    Options opts;
    if (!parseArgs(argc, argv, opts)) {
        return 1;
    }

    // List devices mode (doesn't require document)
    if (opts.list_devices) {
        return doListDevices();
    }

    // Load document
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
