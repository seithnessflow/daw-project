// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file midi_input.h
 * @brief Un port MIDI d'entree du systeme -> la file MIDI live du moteur.
 *
 * Backend WinMM sur Windows (midi_input_winmm.cpp) ; stub ailleurs
 * (midi_input_stub.cpp : liste vide, open() refuse en clair) - la CI Linux
 * compile sans WinMM. Le callback du driver (thread systeme) ne fait que
 * parser + pousser dans la LiveMidiQueue (producteur unique) + compter ;
 * jamais de log, de blocage ni de COM dedans (contrainte WinMM). L'objet
 * n'est ni copiable ni deplacable : le driver garde son adresse
 * (dwInstance). close() : stop -> reset -> close ; la file reste vivante
 * pendant le stop (le callback peut encore tirer un coup).
 */

#include "live_midi.h"

#include <cstdint>
#include <string>
#include <vector>

namespace daw::midi {

class MidiInput {
public:
    MidiInput() = default;
    ~MidiInput() { close(); }
    MidiInput(const MidiInput&) = delete;
    MidiInput& operator=(const MidiInput&) = delete;
    MidiInput(MidiInput&&) = delete;
    MidiInput& operator=(MidiInput&&) = delete;

    /** Noms des ports d'entree MIDI du systeme (UTF-8), dans l'ordre du systeme. */
    static std::vector<std::string> listDevices();

    /** Ouvre le premier port dont le nom CONTIENT `substring` (insensible a
     *  la casse) et commence a pousser dans `queue`. false + err sinon. */
    bool open(const std::string& substring, LiveMidiQueue* queue,
              LiveMidiStats* stats, std::string& err);
    void close() noexcept;
    [[nodiscard]] bool isOpen() const noexcept { return handle_ != nullptr; }
    [[nodiscard]] const std::string& deviceName() const noexcept { return name_; }

    /** Entree du callback driver (thread systeme) : un message court. */
    void onShortMessage(uint32_t packed, int64_t now_ns) noexcept;

private:
    void* handle_ = nullptr;  // HMIDIIN sur Windows
    LiveMidiQueue* queue_ = nullptr;
    LiveMidiStats* stats_ = nullptr;
    std::string name_;
};

}  // namespace daw::midi
