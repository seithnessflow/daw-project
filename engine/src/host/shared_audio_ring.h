// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file shared_audio_ring.h
 * @brief The shared-memory segment between engine and plugin host (ADR-017).
 *
 * THIS LAYOUT IS A BINARY CONTRACT BETWEEN TWO EXECUTABLES compiled
 * separately: engine and plugin_host both include this exact header, and
 * the static_asserts below (sizeof + offsetof on every field) turn any
 * silent padding/ordering divergence into a compile error. This is the
 * SCHEMA.md of the binary world - bump kLayoutVersion on ANY change.
 *
 * Concurrency rules (same guarantee family as the sacred thread, new
 * boundary):
 * - Every synchronization field is a std::atomic that MUST be lock-free
 *   (asserted below): std::atomic works across processes only if it lives
 *   physically in the shared segment and is address-free/lock-free.
 * - NO STL mutex ever goes in this segment (a kernel object is not a
 *   memory object; an STL mutex in shared memory is undefined behavior in
 *   a trench coat). Sequence-published double buffers only - the peaks
 *   mold, across a process boundary.
 *
 * Pipelined exchange (decided in TODO 2.4c-1, DEPTH REVISED the same day):
 * the engine deposits block N and collects block N-depth. The original
 * one-frame depth assumed a regular block cadence; reality (first live
 * run, 534/1875 blocks missed): the driver delivers bursts of
 * buffer_size/256 blocks back-to-back microseconds apart, so the child
 * must be given a full DEVICE PERIOD, not a block period. Depth is a
 * NODE-SIDE POLICY (= blocks per device callback, 2 for the 512 default),
 * the layout only provides enough slots (kRingSlots=4 covers depth<=2
 * with write/read separation). Cost: depth blocks of latency, declared
 * via getLatencySamples() in 2.4d. A missing block is NEVER waited for on
 * the audio thread: bypass + incident counter. Child death is detected by
 * the CONTROL thread via the process handle - the callback only knows
 * "block ready or not".
 */

#include <atomic>
#include <cstddef>
#include <cstdint>

namespace daw::host {

inline constexpr uint32_t kRingMagic = 0x52574144;  // 'DAWR'
inline constexpr uint32_t kLayoutVersion = 12;      // v12: ProcessContext (position par slot, tempo, play) ; v11: FIFO MIDI generique ; v10: kRingSlots 8 + stamps par slot (A4-5) ; v9: editor_open ; v8: MIDI FIFO
inline constexpr uint32_t kParamQueueSlots = 64;    // power of two
inline constexpr uint32_t kMidiQueueSlots = 256;    // power of two; note events per block, drained by the child
inline constexpr uint32_t kRingBlockSize = 256;     // == audio::INTERNAL_BLOCK_SIZE
inline constexpr uint32_t kRingChannels = 2;
// v10 (contrat de periode) : 8 slots couvrent depth <= 6 (periode
// jusqu'a 1536 frames) avec separation ecriture/lecture. Le plafond de
// profondeur des consommateurs est kRingSlots-2 ; le depasser demande
// un nouveau bump de layout, JAMAIS un clamp silencieux (main.cpp
// avertit en clair quand il clampe).
inline constexpr uint32_t kRingSlots = 8;           // power of two; covers depth <= 6

struct SharedAudioRing {
    // ---- Contract header (plain, written once by the engine) ----
    uint32_t magic;
    uint32_t layout_version;
    uint32_t block_size;
    uint32_t sample_rate;

    // ---- Sequencing (block numbers start at 1; 0 = nothing yet) ----
    // Engine: publishes after writing input slot (seq % kRingSlots)
    std::atomic<uint64_t> input_seq;
    // Child: publishes after writing the matching output slot
    std::atomic<uint64_t> output_seq;

    // ---- Parameter channel (v5): SPSC FIFO ---------------------------------
    // The v3/v4 single seqlock SLOT lost every param but the last of a
    // burst (one read per block, latest-wins) - invisible with AGain's
    // single param, immediate with any REAL multi-param plugin (mda):
    // a rebuild re-sends the document's params back-to-back and N-1
    // vanished. Now a FIFO: single writer (control thread) pushes
    // {id, value} pairs; single reader (child) DRAINS everything
    // pending into one block's IParameterChanges.
    //   writer: if full, overwrite the OLDEST (advance read_idx) - a
    //   64-deep burst degrades to latest-wins per id, never a stall
    //   on the control thread.
    //   reader: while read_idx != write_idx (acquire), read pair at
    //   read_idx, then advance read_idx (release).
    // Slot fields are plain (not atomic): the indices order them - a
    // slot is only read after write_idx is published past it.
    std::atomic<uint64_t> param_write_idx;
    std::atomic<uint64_t> param_read_idx;
    uint32_t param_ids[kParamQueueSlots];
    double param_values[kParamQueueSlots];

    // ---- Lifecycle ----
    std::atomic<uint32_t> shutdown;     // engine sets 1; child exits cleanly
    // ---- Fenetre GUI a la demande (v9) : moteur -> enfant --------------------
    // Etat DESIRE de la fenetre du plugin (0 = fermee, 1 = ouverte). Le moteur
    // l'ecrit sur le message kEditor (bouton box de la piste) ; l'enfant compare
    // a l'etat courant de sa fenetre a chaque tour de boucle serve et
    // ouvre/ferme en consequence. Loge dans le padding naturel entre shutdown
    // (uint32) et child_heartbeat (uint64, aligne 8) : offsets suivants
    // inchanges. L'ouverture au spawn (--editor) reste une voie parallele.
    std::atomic<uint32_t> editor_open;
    std::atomic<uint64_t> child_heartbeat;  // child bumps per processed block

    // ---- State side-channel (2.5-etat, v4) ----
    // The BLOB never crosses the ring: it travels through the file
    // `<segment>.state` next to the segment. These two sequences only
    // coordinate WHO wrote it last:
    //   save:    engine bumps state_request_seq; the child serializes
    //            IComponent state to the file, then copies the request
    //            into state_ready_seq. Engine waits (bounded, control
    //            thread) for ready >= its request, then reads the file.
    //   restore: the engine writes the file BEFORE spawn/restart; the
    //            child loads it during its ceremony (processor-first),
    //            before the heartbeat says ready.
    std::atomic<uint64_t> state_request_seq;
    std::atomic<uint64_t> state_ready_seq;

    // ---- Edits GUI (fenetrage v1, v6) ----
    // L'enfant bump quand des performEdit de la fenetre ont ete pousses
    // dans le COMPOSANT (drain au bloc suivant, ou flush numSamples==0 a
    // l'arret). Le moteur le sonde au rythme telemetrie et programme la
    // capture d'etat debouncee : un reglage a la fenetre SURVIT (blob au
    // store, hash au document) et VOYAGE (cle de stem -> les pairs
    // re-entendent le reglage sans avoir le plugin).
    std::atomic<uint64_t> gui_edit_seq;

    // ---- PDC ecrivain (session 3, v7) ----
    // La latence INTERNE declaree par le plugin (IAudioProcessor::
    // getLatencySamples), ecrite par l'enfant apres sa ceremonie et a
    // chaque kLatencyChanged futur. Le rendu de stem la SOMME sur la
    // chaine et la declare au document (stemLatencySamples) - le
    // lecteur (graph_common, gteste) avance le stem d'autant. AGain et
    // les plugins sans lookahead ecrivent 0 : le flux est le meme.
    // uint64 pour garder les offsets multiples de 8 (pas de padding).
    std::atomic<uint64_t> plugin_latency_samples;

    // ---- MIDI event channel (v8, GENERIQUE v11): SPSC FIFO ---------------
    // L'ENGINE pousse les evenements MIDI du bloc ; l'ENFANT les DRAINE
    // avant process() : notes -> IEventList VST3, CC / pitch-bend ->
    // IParameterChanges via IMidiMapping (VST3 n'a pas d'evenement CC : un
    // controleur EST un parametre que le plugin declare). Meme discipline
    // d'indices que le FIFO param (slots plain, ordonnes par les index).
    // FORMAT FIL MIDI (v11, A3-1 « la file est generique ») : kind +
    // data1/data2 7 bits, comme sur le cable - note (pitch, velocite), CC
    // (controleur, valeur), pitch-bend (LSB, MSB). Un evenement nouveau
    // (aftertouch, program) = un kind de plus, JAMAIS un bump de layout.
    // Les evenements sont TRANSITOIRES : jamais rejoues a un cold restart
    // (contrairement aux params) - un restart envoie un all-notes-off.
    // Plein = on ecrase le plus VIEUX (avance read_idx), le producteur ne
    // stalle jamais (> 256 evenements/bloc n'est jamais legitime).
    std::atomic<uint64_t> midi_write_idx;
    std::atomic<uint64_t> midi_read_idx;
    uint8_t  midi_kind[kMidiQueueSlots];      // MidiKind (0 off, 1 on, 2 CC, 3 pitch-bend)
    uint8_t  midi_data1[kMidiQueueSlots];     // pitch | controleur | LSB (0..127)
    uint8_t  midi_data2[kMidiQueueSlots];     // velocite | valeur | MSB (0..127)
    uint8_t  midi_channel[kMidiQueueSlots];   // 0..15
    uint32_t midi_offset[kMidiQueueSlots];    // offset en samples DANS le bloc

    // ---- Estampilles PAR SLOT (v10, A4-5) --------------------------------
    // in_slot_seq[slot] : l'ENGINE estampille seq APRES avoir ecrit
    // in[slot] (release, avant input_seq). out_slot_seq[slot] :
    // l'ENFANT estampille seq APRES que process() a ecrit out[slot].
    // LE test de collecte est out_slot_seq[wslot] == want : un
    // output_seq simplement avance peut pointer un slot PERIME quand
    // l'enfant a saute des blocs (rattrapage) - le rejouer n'etait ni
    // du wet ni compte (le bug A4-5).
    // INVARIANT INPUT-DECHIRE (grave ici, la ou il vit) : le segment
    // n'empeche PAS l'engine d'ecraser in[slot] pendant que l'enfant
    // le lit (zero-copy). La detection : l'enfant RE-verifie
    // in_slot_seq[slot] == seq apres process et NE PUBLIE PAS la
    // sortie d'un bloc dont l'entree a bouge - l'engine le sert dry
    // et le compte (blocks_missed), jamais un wet menteur.
    std::atomic<uint64_t> in_slot_seq[kRingSlots];
    std::atomic<uint64_t> out_slot_seq[kRingSlots];

    // ---- ProcessContext (v12) : ce que le plugin sait du transport --------
    // VST3 ne donne tempo/position/play qu'a travers ProcessData::
    // processContext ; sans lui, delays synchronises, arpegiateurs et LFO
    // tournent sur leur defaut interne (AUDIT-6 §6). L'ENGINE ecrit la
    // position d'arrangement DU BLOC dans in_slot_pos[slot] (avant
    // l'estampille du slot - c'est la position de CE bloc, pipeline
    // compris), le tempo (milli-BPM entier, invariant document) et l'etat
    // play/stop (globaux : un bloc de decalage est sans consequence).
    // L'ENFANT lit tout ca en remplissant ProcessContext pour le bloc seq.
    // Tempo 0 = inconnu (kTempoValid non pose).
    std::atomic<int64_t> in_slot_pos[kRingSlots];
    std::atomic<int64_t> transport_tempo_milli_bpm;
    std::atomic<uint64_t> transport_playing;

    // ---- Planar audio, double-buffered: [slot][channel][frame] ----
    float in[kRingSlots][kRingChannels][kRingBlockSize];
    float out[kRingSlots][kRingChannels][kRingBlockSize];
};

// ---- The binary contract, compiler-enforced --------------------------------
static_assert(std::is_standard_layout_v<SharedAudioRing>,
              "shared segment must be standard layout");
static_assert(std::atomic<uint64_t>::is_always_lock_free &&
              std::atomic<uint32_t>::is_always_lock_free &&
              std::atomic<double>::is_always_lock_free,
              "cross-process atomics must be lock-free (address-free)");
static_assert(offsetof(SharedAudioRing, magic) == 0);
static_assert(offsetof(SharedAudioRing, layout_version) == 4);
static_assert(offsetof(SharedAudioRing, block_size) == 8);
static_assert(offsetof(SharedAudioRing, sample_rate) == 12);
static_assert(offsetof(SharedAudioRing, input_seq) == 16);
static_assert(offsetof(SharedAudioRing, output_seq) == 24);
static_assert(offsetof(SharedAudioRing, param_write_idx) == 32);
static_assert(offsetof(SharedAudioRing, param_read_idx) == 40);
static_assert(offsetof(SharedAudioRing, param_ids) == 48);
static_assert(offsetof(SharedAudioRing, param_values) == 48 + kParamQueueSlots * 4);
static_assert(offsetof(SharedAudioRing, shutdown) == 48 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, editor_open) == 52 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, child_heartbeat) == 56 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, state_request_seq) == 64 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, state_ready_seq) == 72 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, gui_edit_seq) == 80 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, plugin_latency_samples) == 88 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, midi_write_idx) == 96 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, midi_read_idx) == 104 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, midi_kind) == 112 + kParamQueueSlots * 12);
static_assert(offsetof(SharedAudioRing, midi_data1) == 112 + kParamQueueSlots * 12 + kMidiQueueSlots);
static_assert(offsetof(SharedAudioRing, midi_data2) == 112 + kParamQueueSlots * 12 + 2 * kMidiQueueSlots);
static_assert(offsetof(SharedAudioRing, midi_channel) == 112 + kParamQueueSlots * 12 + 3 * kMidiQueueSlots);
static_assert(offsetof(SharedAudioRing, midi_offset) == 112 + kParamQueueSlots * 12 + 4 * kMidiQueueSlots);
static_assert(offsetof(SharedAudioRing, in_slot_seq) ==
              112 + kParamQueueSlots * 12 + 8 * kMidiQueueSlots);
static_assert(offsetof(SharedAudioRing, out_slot_seq) ==
              112 + kParamQueueSlots * 12 + 8 * kMidiQueueSlots +
                  8 * kRingSlots);
static_assert(offsetof(SharedAudioRing, in_slot_pos) ==
              112 + kParamQueueSlots * 12 + 8 * kMidiQueueSlots +
                  16 * kRingSlots);
static_assert(offsetof(SharedAudioRing, transport_tempo_milli_bpm) ==
              112 + kParamQueueSlots * 12 + 8 * kMidiQueueSlots +
                  24 * kRingSlots);
static_assert(offsetof(SharedAudioRing, transport_playing) ==
              112 + kParamQueueSlots * 12 + 8 * kMidiQueueSlots +
                  24 * kRingSlots + 8);
static_assert(offsetof(SharedAudioRing, in) ==
              112 + kParamQueueSlots * 12 + 8 * kMidiQueueSlots +
                  24 * kRingSlots + 16);
static_assert(offsetof(SharedAudioRing, out) ==
              112 + kParamQueueSlots * 12 + 8 * kMidiQueueSlots +
                  24 * kRingSlots + 16 +
                  kRingSlots * kRingChannels * kRingBlockSize * 4);
static_assert(sizeof(SharedAudioRing) ==
              112 + kParamQueueSlots * 12 + 8 * kMidiQueueSlots +
                  24 * kRingSlots + 16 +
                  2 * (kRingSlots * kRingChannels * kRingBlockSize * 4),
              "layout drifted - bump kLayoutVersion and fix BOTH sides");

// ---- Le FIFO MIDI generique (v11) ------------------------------------------
enum class MidiKind : uint8_t {
    NoteOff = 0,        // data1 = pitch, data2 = velocite de relachement
    NoteOn = 1,         // data1 = pitch, data2 = velocite
    ControlChange = 2,  // data1 = controleur 0..127, data2 = valeur 0..127
    PitchBend = 3,      // data1 = LSB, data2 = MSB (14 bits, 8192 = centre)
};

struct MidiEvent {
    MidiKind kind = MidiKind::NoteOff;
    uint8_t channel = 0;        // 0..15
    uint8_t data1 = 0;          // 7 bits
    uint8_t data2 = 0;          // 7 bits
    uint32_t sample_offset = 0; // dans le bloc
};

// Valeur 14 bits d'un pitch-bend (LSB puis MSB, comme sur le fil).
inline constexpr uint16_t midiPitchBend14(uint8_t lsb, uint8_t msb) noexcept {
    return static_cast<uint16_t>((static_cast<uint16_t>(msb & 0x7F) << 7) |
                                 (lsb & 0x7F));
}

// Ecrit UN evenement dans le FIFO MIDI (SPSC, single writer). Utilise par
// PluginBridge (offline, thread de controle) ET ProxyNode (live, thread
// audio) - JAMAIS les deux sur le meme ring simultanement (regle
// un-producteur-par-ring, cf. proxy_node.h). RT-safe : que des atomics et des
// ecritures de slots plain, aucune alloc/syscall. Plein = ecrase le plus
// vieux (avance read_idx), l'ecrivain ne stalle jamais.
inline void pushMidiEvent(SharedAudioRing* ring, const MidiEvent& ev) noexcept {
    const uint64_t w = ring->midi_write_idx.load(std::memory_order_relaxed);
    uint64_t r = ring->midi_read_idx.load(std::memory_order_acquire);
    if (w - r >= kMidiQueueSlots) {
        ring->midi_read_idx.compare_exchange_strong(r, r + 1,
                                                    std::memory_order_acq_rel);
    }
    const uint32_t slot = static_cast<uint32_t>(w % kMidiQueueSlots);
    ring->midi_kind[slot] = static_cast<uint8_t>(ev.kind);
    ring->midi_data1[slot] = ev.data1 & 0x7F;
    ring->midi_data2[slot] = ev.data2 & 0x7F;
    ring->midi_channel[slot] = ev.channel & 0x0F;
    ring->midi_offset[slot] = ev.sample_offset;
    ring->midi_write_idx.store(w + 1, std::memory_order_release);
}

// La forme note (v8) conservee : les appelants existants (schedule de
// timeline, session, all-notes-off, bridge offline) ne changent pas.
inline void pushMidiEvent(SharedAudioRing* ring, bool note_on, uint8_t pitch,
                          uint8_t velocity, uint8_t channel,
                          uint32_t sample_offset) noexcept {
    MidiEvent ev;
    ev.kind = note_on ? MidiKind::NoteOn : MidiKind::NoteOff;
    ev.channel = channel;
    ev.data1 = pitch;
    ev.data2 = velocity;
    ev.sample_offset = sample_offset;
    pushMidiEvent(ring, ev);
}

// Lit UN evenement (single reader : l'enfant). Reclame le slot AVANT de
// faire confiance a son contenu : si le producteur a ecrase ce slot
// pendant la lecture (course file-pleine), le CAS echoue et l'appelant
// re-boucle sur le slot frais. false = FIFO vide. Meme fonction dans
// l'enfant et dans le gtest : le decodage n'a qu'un exemplaire.
inline bool popMidiEvent(SharedAudioRing* ring, MidiEvent& out) noexcept {
    while (true) {
        uint64_t r = ring->midi_read_idx.load(std::memory_order_relaxed);
        if (r >= ring->midi_write_idx.load(std::memory_order_acquire)) return false;
        const uint32_t slot = static_cast<uint32_t>(r % kMidiQueueSlots);
        out.kind = static_cast<MidiKind>(ring->midi_kind[slot]);
        out.data1 = ring->midi_data1[slot];
        out.data2 = ring->midi_data2[slot];
        out.channel = ring->midi_channel[slot];
        out.sample_offset = ring->midi_offset[slot];
        if (ring->midi_read_idx.compare_exchange_strong(
                r, r + 1, std::memory_order_acq_rel)) {
            return true;
        }
        // le producteur nous a depasses : le slot etait perime, on relit
    }
}

}  // namespace daw::host
