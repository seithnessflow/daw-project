// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file processor_node.h
 * @brief Base interface for audio processing nodes.
 *
 * All processor nodes must implement this interface. Processing methods
 * may be called from the audio thread and must follow sacred thread rules.
 */

#include <cstdint>
#include <string>

// Vague 3 : l'evenement MIDI generique du ring (host/shared_audio_ring.h).
// Forward-declare seulement : le graphe ne tire pas le segment partage.
namespace daw::host { struct MidiEvent; }

namespace daw::graph {

/**
 * Base interface for audio processors.
 *
 * All methods that may be called from the audio thread are marked noexcept
 * and must not allocate, lock, or perform any blocking operations.
 */
class ProcessorNode {
public:
    virtual ~ProcessorNode() = default;

    /**
     * Process audio samples.
     *
     * AUDIO THREAD - Sacred thread rules apply.
     *
     * @param output Output buffer (interleaved stereo: L0,R0,L1,R1,...)
     * @param input Input buffer (same format), may be nullptr
     * @param frame_count Number of frames to process
     * @param position_samples Current timeline position in samples
     */
    virtual void process(
        float* output,
        const float* input,
        uint32_t frame_count,
        int64_t position_samples
    ) noexcept = 0;

    /**
     * Get the processor type identifier.
     */
    [[nodiscard]] virtual const std::string& getType() const noexcept = 0;

    /**
     * Get the processor instance ID.
     */
    [[nodiscard]] virtual const std::string& getId() const noexcept = 0;

    /**
     * Set a parameter value.
     *
     * This is called from the control thread. Parameter updates should be
     * atomic or use a mechanism that doesn't block the audio thread.
     *
     * @param name Parameter name
     * @param value New value
     * @return true if parameter was set successfully
     */
    virtual bool setParameter(const std::string& name, float value) noexcept = 0;

    /**
     * Get a parameter value.
     *
     * @param name Parameter name
     * @return Parameter value, or 0.0 if not found
     */
    [[nodiscard]] virtual float getParameter(const std::string& name) const noexcept = 0;

    /**
     * Latency this node introduces, in samples (2.4d, AUDIT R3).
     *
     * ALWAYS A COMPUTATION, never a constant: a pipelined proxy returns
     * depth x block size from its LIVE depth. Control thread reads it for
     * telemetry and (one day) PDC; it must not change while active.
     */
    [[nodiscard]] virtual uint32_t getLatencySamples() const noexcept { return 0; }

    /**
     * Prepare for playback.
     *
     * Called before audio processing starts. May allocate resources.
     *
     * @param sample_rate Sample rate in Hz
     * @param max_block_size Maximum block size that will be requested
     */
    virtual void prepare(uint32_t sample_rate, uint32_t max_block_size) = 0;

    /**
     * Reset internal state.
     *
     * Called when seeking or stopping. Should clear any internal buffers
     * or delay lines to prevent audio artifacts.
     */
    virtual void reset() noexcept = 0;

    /**
     * Fenetre GUI a la demande (v9) : ouvrir/fermer la fenetre native du
     * plugin de ce node. Control thread (message kEditor). Defaut : no-op -
     * seuls les nodes qui hebergent un plugin hors-process (ProxyNode) la
     * portent, via l'atomic editor_open du ring vers l'enfant.
     */
    virtual void setEditorOpen(bool /*open*/) noexcept {}

    // ---- F5 : MIDI de session (thread audio) -----------------------------
    // Defaut no-op : seul un node-instrument (ProxyNode) les porte, via le
    // FIFO MIDI du ring. AUDIO THREAD (appeles par processTrack).
    /** Emet UN evenement de note pour le bloc courant (offset dans le bloc). */
    virtual void emitMidi(bool /*note_on*/, uint8_t /*pitch*/, uint8_t /*velocity*/,
                          uint32_t /*sample_offset*/) noexcept {}
    /** Quand true, le node n'emet PAS ses notes de timeline ce bloc (un slot
     *  de session a pris la piste). Etat plein (meme thread), pas atomique. */
    virtual void setSuppressTimelineNotes(bool /*on*/) noexcept {}
    /** Coupe toutes les notes en cours (note-off 0..127 au sample 0). Appele
     *  a la transition de launch pour ne laisser aucune note bloquee. */
    virtual void allNotesOff() noexcept {}
    /** Vague 3 : un evenement MIDI GENERIQUE (note, CC, pitch-bend, canal
     *  du fil) pour le bloc courant - l'entree live passe par la. AUDIO
     *  THREAD (appele par AudioGraph::process). Defaut no-op. */
    virtual void emitMidiEvent(const daw::host::MidiEvent& /*ev*/) noexcept {}
    /** ProcessContext (v12) : ce que le transport sait, pour le bloc a
     *  venir - etat play/stop et tempo (milli-BPM entier). Appele par
     *  processTrack AVANT process() sur chaque node de la chaine ; seuls
     *  les nodes qui hebergent un plugin (Proxy/SyncProxy) le relaient.
     *  AUDIO THREAD (live) ou thread de controle (offline). Defaut no-op. */
    virtual void setTransportContext(bool /*playing*/, int64_t /*tempo_milli_bpm*/) noexcept {}
};

}  // namespace daw::graph
