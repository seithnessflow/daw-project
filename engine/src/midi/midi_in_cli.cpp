// SPDX-License-Identifier: GPL-3.0-or-later
#include "midi_in_cli.h"

#include "../graph/audio_graph.h"

#include <iomanip>
#include <iostream>

namespace daw::midi {

int listMidiDevicesCli() {
    const auto names = MidiInput::listDevices();
    std::cout << "Available MIDI input ports:\n\n";
    for (size_t i = 0; i < names.size(); ++i) {
        std::cout << "  " << (i + 1) << ". " << names[i] << "\n";
    }
    if (names.empty()) std::cout << "  No MIDI input port found.\n";
    std::cout << "\nUse --midi-in <name> (substring, case-insensitive) to open one.\n";
    return 0;
}

bool openMidiInCli(const std::string& name, MidiInput& input,
                   LiveMidiQueue* queue, LiveMidiStats* stats) {
    std::string err;
    if (!input.open(name, queue, stats, err)) {
        std::cerr << "ERROR: midi-in: " << err << "\n";
        return false;
    }
    std::cerr << "midi-in: opened \"" << input.deviceName() << "\"\n";
    return true;
}

int32_t resolveLiveMidiTrack(graph::AudioGraph& graph, const std::string& wanted_id,
                             bool& warned, std::string& last_logged) {
    int32_t index = -1;
    const char* how = "auto";
    const size_t n = graph.getTrackCount();
    if (!wanted_id.empty()) {
        for (size_t i = 0; i < n; ++i) {
            auto* t = graph.getTrack(i);
            if (t && t->id == wanted_id) {
                if (t->instrument_node) { index = static_cast<int32_t>(i); how = "--midi-track"; }
                else if (!warned) {
                    warned = true;
                    std::cerr << "WARNING: midi-in: --midi-track \"" << wanted_id
                              << "\" has no instrument (vst3 node) - falling back to auto\n";
                }
                break;
            }
        }
        if (index < 0 && !warned && n > 0) {
            warned = true;
            std::cerr << "WARNING: midi-in: --midi-track \"" << wanted_id
                      << "\" not found - falling back to auto\n";
        }
    }
    if (index < 0) {
        for (size_t i = 0; i < n; ++i) {
            auto* t = graph.getTrack(i);
            if (t && t->instrument_node) { index = static_cast<int32_t>(i); break; }
        }
    }
    std::string line;
    if (index >= 0) {
        line = "midi-in: -> track \"" + graph.getTrack(static_cast<size_t>(index))->id +
               "\" (" + how + ")";
    } else {
        line = "midi-in: no instrument track yet (waiting for a vst3 node)";
    }
    if (line != last_logged) {
        std::cerr << line << "\n";
        last_logged = line;
    }
    return index;
}

void logMidiStats(const LiveMidiStats& stats, double pipeline_ms, std::ostream& out) {
    const auto ms = [](int64_t ns) { return static_cast<double>(ns) / 1e6; };
    out << "midi-in stats: events=" << stats.drained.load(std::memory_order_relaxed)
        << " forwarded=" << stats.forwarded.load(std::memory_order_relaxed)
        << " dropped=" << stats.dropped_full.load(std::memory_order_relaxed)
        << " unrouted=" << stats.unrouted.load(std::memory_order_relaxed)
        << std::fixed << std::setprecision(1)
        << " queue-lat last=" << ms(stats.lat_last_ns.load(std::memory_order_relaxed))
        << " ms max=" << ms(stats.lat_max_ns.load(std::memory_order_relaxed))
        << " ms pipeline~" << pipeline_ms << " ms\n";
}

}  // namespace daw::midi
