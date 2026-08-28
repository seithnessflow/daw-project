// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file audio_graph.h
 * @brief Audio processing graph.
 *
 * The audio graph is a projection of the project document. It is rebuilt
 * whenever the document changes, and swapped atomically with the active
 * graph on the audio thread.
 */

#include "processor_node.h"
#include "clip_player.h"
#include "gain_node.h"
#include "automation.h"             // A2 : enveloppes (evaluation pure)
#include "stage_probe.h"            // preuve audio par etage (offline)
#include "../host/midi_schedule.h"  // F5 : ScheduledNote pour les slots Session
#include "../midi/live_midi.h"      // Vague 3 : MidiEvent + stats du MIDI live

#include <atomic>
#include <memory>
#include <string>
#include <tuple>
#include <vector>

namespace daw::graph {

/**
 * A track in the audio graph.
 *
 * Contains clips and a processing chain.
 */
/**
 * F5 : un SLOT de session = un clip lancable (clip-launcher). Ses notes sont
 * en positions LOCALES [0, loop_len) ; joue en boucle sur l'horloge de session
 * quand il est lance. scene_id sert au handler (control thread) a retrouver
 * l'index du slot a lancer.
 */
struct SessionSlot {
    std::string scene_id;
    int64_t loop_len = 0;
    std::vector<daw::host::ScheduledNote> notes;
};

/**
 * F5+ : prochaine frontiere de quantum >= now, sur la grille posee par
 * l'ancre (epoch + k*quantum). now == frontiere -> now (lancement immediat).
 * Helper PUR (teste dans cli_integration_test sans graphe).
 */
[[nodiscard]] constexpr int64_t nextQuantumStart(int64_t now, int64_t epoch,
                                                 int64_t quantum) noexcept {
    if (quantum <= 0) return now;
    const int64_t since = now - epoch;
    if (since <= 0) return epoch;  // avant l'epoque : la grille commence la
    const int64_t k = (since + quantum - 1) / quantum;  // ceil
    return epoch + k * quantum;
}

struct AudioTrack {
    std::string id;
    std::string name;
    std::atomic<float> gain{1.0f};  // Track gain (atomic for real-time updates)
    std::atomic<float> pan{0.0f};   // F2: -1..+1 pan (atomic, same mold as gain)

    std::vector<ClipPlayer> clips;
    std::vector<std::unique_ptr<ProcessorNode>> chain;

    // Per-track monitoring state (local, not in document). Atomic: written
    // by the WebSocket thread (handleSetMonitor), read by the audio thread
    // (S4 - same mold as gain/peaks, relaxed is sufficient).
    std::atomic<bool> solo{false};
    std::atomic<bool> mute{false};

    // F5 (launch Session). session_slots : construits en buildGraph (immuable
    // une fois actif). launched_slot : index du slot lance (-1 = aucun), ecrit
    // par le control thread (message launch), lu par le thread audio.
    // launch_clock : valeur de l'horloge de session au lancement (rebasage).
    // instrument_node : le node (ProxyNode) qui recoit le MIDI - pointeur NON
    // possedant vers la chaine ; l'objet node est heap (unique_ptr), son adresse
    // survit au move de la piste. prev_launched : etat vu par le thread audio
    // au bloc precedent (detection de transition -> all-notes-off).
    // A2 : lanes d'automation de la piste (copiees du document en
    // buildGraph, IMMUABLES une fois le graphe actif - le thread audio les
    // lit sans verrou, une edition = rebuild comme tout le reste du doc).
    std::vector<daw::document::AutomationLaneDef> automation;

    std::vector<SessionSlot> session_slots;
    std::atomic<int32_t> launched_slot{-1};
    std::atomic<int64_t> launch_clock{0};
    // F5+ (launch quantise) : slot EN FILE, demarre a queued_start (une
    // frontiere de quantum). Ecrit par le control thread ; PROMU launched par
    // le thread audio quand l'horloge atteint queued_start. Le slot courant
    // continue de jouer jusqu'a la promotion (comportement Ableton).
    std::atomic<int32_t> queued_slot{-1};
    std::atomic<int64_t> queued_start{0};
    ProcessorNode* instrument_node = nullptr;
    int32_t prev_launched = -1;

    // Default constructor
    AudioTrack() = default;

    // Move constructor (atomics not movable, so we copy value)
    AudioTrack(AudioTrack&& other) noexcept
        : id(std::move(other.id))
        , name(std::move(other.name))
        , gain(other.gain.load(std::memory_order_relaxed))
        , pan(other.pan.load(std::memory_order_relaxed))
        , clips(std::move(other.clips))
        , chain(std::move(other.chain))
        , solo(other.solo.load(std::memory_order_relaxed))
        , mute(other.mute.load(std::memory_order_relaxed))
        , automation(std::move(other.automation))
        , session_slots(std::move(other.session_slots))
        , launched_slot(other.launched_slot.load(std::memory_order_relaxed))
        , launch_clock(other.launch_clock.load(std::memory_order_relaxed))
        , queued_slot(other.queued_slot.load(std::memory_order_relaxed))
        , queued_start(other.queued_start.load(std::memory_order_relaxed))
        , instrument_node(other.instrument_node)
        , prev_launched(other.prev_launched) {}

    // Move assignment
    AudioTrack& operator=(AudioTrack&& other) noexcept {
        if (this != &other) {
            id = std::move(other.id);
            name = std::move(other.name);
            gain.store(other.gain.load(std::memory_order_relaxed), std::memory_order_relaxed);
            pan.store(other.pan.load(std::memory_order_relaxed), std::memory_order_relaxed);
            clips = std::move(other.clips);
            chain = std::move(other.chain);
            solo.store(other.solo.load(std::memory_order_relaxed), std::memory_order_relaxed);
            mute.store(other.mute.load(std::memory_order_relaxed), std::memory_order_relaxed);
            automation = std::move(other.automation);
            session_slots = std::move(other.session_slots);
            launched_slot.store(other.launched_slot.load(std::memory_order_relaxed), std::memory_order_relaxed);
            launch_clock.store(other.launch_clock.load(std::memory_order_relaxed), std::memory_order_relaxed);
            queued_slot.store(other.queued_slot.load(std::memory_order_relaxed), std::memory_order_relaxed);
            queued_start.store(other.queued_start.load(std::memory_order_relaxed), std::memory_order_relaxed);
            instrument_node = other.instrument_node;
            prev_launched = other.prev_launched;
        }
        return *this;
    }

    // Non-copyable (unique_ptr in chain)
    AudioTrack(const AudioTrack&) = delete;
    AudioTrack& operator=(const AudioTrack&) = delete;
};

/**
 * Audio processing graph.
 *
 * Contains all tracks and manages mixing. This is immutable once created -
 * updates are done by building a new graph and swapping atomically.
 */
class AudioGraph {
public:
    AudioGraph();
    ~AudioGraph();

    // Non-copyable
    AudioGraph(const AudioGraph&) = delete;
    AudioGraph& operator=(const AudioGraph&) = delete;

    // Movable
    AudioGraph(AudioGraph&&) noexcept;
    AudioGraph& operator=(AudioGraph&&) noexcept;

    /**
     * Process audio for all tracks.
     *
     * AUDIO THREAD - Sacred thread rules apply.
     *
     * @param output Output buffer (interleaved stereo)
     * @param frame_count Number of frames to process
     * @param position_samples Current timeline position
     * @return true on success, false on underrun
     */
    bool process(
        float* output,
        uint32_t frame_count,
        int64_t position_samples
    ) noexcept;

    /**
     * Prepare all tracks for playback.
     *
     * Must be called before processing starts.
     *
     * @param sample_rate Sample rate in Hz
     * @param max_block_size Maximum block size
     */
    void prepare(uint32_t sample_rate, uint32_t max_block_size);

    /**
     * Reset all tracks.
     */
    void reset() noexcept;

    /**
     * Add a track to the graph.
     *
     * NOT thread-safe. Only call during graph construction.
     */
    void addTrack(AudioTrack track);

    /**
     * Get the number of tracks.
     */
    [[nodiscard]] size_t getTrackCount() const noexcept {
        return tracks_.size();
    }

    /**
     * Get a track by index.
     */
    [[nodiscard]] AudioTrack* getTrack(size_t index) noexcept {
        return index < tracks_.size() ? &tracks_[index] : nullptr;
    }

    /**
     * Get a track by ID.
     */
    [[nodiscard]] AudioTrack* getTrackById(const std::string& id) noexcept;

    /**
     * Get a chain node by its proc id (v9 : fenetre GUI a la demande).
     * Control thread ; le graphe est immuable une fois actif.
     */
    [[nodiscard]] ProcessorNode* getNodeById(const std::string& id) noexcept;

    // ---- F5 : launch des slots Session -----------------------------------
    /**
     * Horloge de SESSION (libre) : un compteur de samples que le callback fait
     * avancer a CHAQUE bloc, meme transport a l'arret. Les slots lances s'y
     * rebasent (independants de la position d'arrangement). Ecrit par le
     * thread audio avant process, lu par processTrack.
     */
    void setSessionClock(int64_t clock) noexcept {
        session_clock_.store(clock, std::memory_order_relaxed);
    }

    /**
     * Vague 3 etape 0 : le graphe SAIT si le transport joue. Quand le
     * callback le traite a l'ARRET (slot de session lance, MIDI live arme),
     * les clips de timeline se taisent et les notes de timeline ne sont pas
     * emises - sinon une piste non lancee rejouerait le meme bloc a
     * l'infini (position gelee). Thread audio seul (mold session_clock) ;
     * defaut true : le rendu offline et les tests existants sont inchanges.
     */
    void setTransportPlaying(bool playing) noexcept { transport_playing_ = playing; }

    // ---- Vague 3 : MIDI live -> instrument de la piste cible ---------------
    /**
     * Piste cible du MIDI live (index, -1 = aucune). Control thread
     * (resolution a chaque build : --midi-track ou premiere piste avec
     * instrument), lu par process(). Arme = le callback traite le graphe
     * meme transport a l'arret (monitoring), comme un slot lance.
     */
    void setLiveMidiTrack(int32_t index) noexcept {
        live_midi_track_.store(index, std::memory_order_relaxed);
    }
    [[nodiscard]] bool liveMidiArmed() const noexcept {
        return live_midi_track_.load(std::memory_order_relaxed) >= 0;
    }
    /**
     * Les evenements draines par le callback pour CE sous-bloc (thread
     * audio seul, pointeur + compte : le tableau appartient au contexte du
     * callback, pas au graphe qui se reconstruit sans arret). process() les
     * route a offset 0 vers l'instrument de la piste cible si elle est
     * audible (non mute, solo-coherente), sinon les compte unrouted ; une
     * transition route -> non-route emet UN all-notes-off (jamais de note
     * bloquee derriere un mute).
     */
    void setLiveMidi(const daw::host::MidiEvent* events, uint32_t count,
                     daw::midi::LiveMidiStats* stats) noexcept {
        live_midi_events_ = events;
        live_midi_count_ = count;
        live_midi_stats_ = stats;
    }

    /**
     * A2 : lanes d'automation du MASTER (racine du doc). A poser AVANT
     * l'activation (buildGraph) - immuables ensuite, lues par le thread
     * audio dans process() (application du master gain).
     */
    void setMasterAutomation(std::vector<daw::document::AutomationLaneDef> lanes) {
        master_automation_ = std::move(lanes);
    }

    /**
     * Preuve audio par etage (2026-08-27) : OFFLINE UNIQUEMENT - nul en
     * live (un if par etage dans processTrack, zero cout RT). Installee
     * par offline_render quand --probe est demande.
     */
    void setStageProbe(StageProbe* probe) noexcept { probe_ = probe; }

    /**
     * Y a-t-il au moins un slot lance ? Le callback l'utilise pour traiter le
     * graphe MEME a l'arret (sinon les slots ne sonneraient qu'en lecture).
     */
    [[nodiscard]] bool anyLaunched() const noexcept {
        return launched_count_.load(std::memory_order_relaxed) > 0;
    }

    /**
     * Lancer / arreter un slot de session (control thread, message launch).
     * stop=true -> arrete ; F5+ : scene_id VIDE arrete quel que soit le slot,
     * scene_id donne n'arrete que si le slot lance/en file appartient a cette
     * scene (avant, stop tuait les slots des AUTRES scenes). Sinon lance le
     * slot de la scene scene_id : immediat si rien ne joue nulle part (le slot
     * devient l'ANCRE : epoque = maintenant, quantum = son loop_len) ou si
     * quantize=false ; sinon EN FILE pour la prochaine frontiere de quantum
     * (promotion par le thread audio, le slot courant joue jusque-la).
     * Retourne false si la piste (ou le slot) est introuvable.
     */
    bool launchSlot(const std::string& track_id, const std::string& scene_id,
                    bool stop, bool quantize = false) noexcept;

    /**
     * T2 : quantum Session MUSICAL (doc v2 = 1 mesure resolue au
     * registre de tempo, samples). 0 = legacy (l'ancre pose quantum =
     * son loop_len). Echantillonne AU LAUNCH de l'ancre : un
     * changement de tempo n'affecte que les prochains lancements.
     */
    void setMusicalQuantum(int64_t samples) noexcept {
        musical_quantum_.store(samples, std::memory_order_relaxed);
    }

    /**
     * F5+ : etat des slots pour la telemetrie (control thread). Un tuple par
     * piste engagee : {track_id, scene_id, queued}.
     */
    [[nodiscard]] std::vector<std::tuple<std::string, std::string, bool>>
    getSessionState() const noexcept;

    /**
     * Set the sample rate.
     */
    void setSampleRate(uint32_t sample_rate) noexcept {
        sample_rate_ = sample_rate;
    }

    /**
     * Get the sample rate.
     */
    [[nodiscard]] uint32_t getSampleRate() const noexcept {
        return sample_rate_;
    }

    /**
     * Get peak meters for all tracks.
     *
     * @return Vector of (track_id, peak_left, peak_right)
     */
    [[nodiscard]] std::vector<std::tuple<std::string, float, float>> getMeters() const noexcept;

    /**
     * Zero all peak meters. AUDIO THREAD SAFE (relaxed atomic stores,
     * the processTrack mold). Called by the callback's silence path:
     * a stopped transport must not report ghost peaks forever
     * (found 2026-08-22 by the life layer's ballistics refusing to rest).
     */
    void clearMeters() noexcept {
        for (size_t i = 0; i < num_tracks_; ++i) {
            peak_left_[i].store(0.0f, std::memory_order_relaxed);
            peak_right_[i].store(0.0f, std::memory_order_relaxed);
        }
        for (size_t k = 0; k < num_nodes_; ++k) {  // T3 : pics device
            node_peak_left_[k].store(0.0f, std::memory_order_relaxed);
            node_peak_right_[k].store(0.0f, std::memory_order_relaxed);
        }
        master_peak_left_.store(0.0f, std::memory_order_relaxed);
        master_peak_right_.store(0.0f, std::memory_order_relaxed);
    }

    /**
     * V1.2: master gain, applied at the end of process() (live AND
     * offline share that path). Set by the builders from the document.
     */
    void setMasterGain(float gain) noexcept {
        master_gain_.store(gain, std::memory_order_relaxed);
    }

    [[nodiscard]] float getMasterGain() const noexcept {
        return master_gain_.load(std::memory_order_relaxed);
    }

    /** V1.2: master peaks, post-gain (written by process, read by telemetry). */
    [[nodiscard]] std::pair<float, float> getMasterPeaks() const noexcept {
        return { master_peak_left_.load(std::memory_order_relaxed),
                 master_peak_right_.load(std::memory_order_relaxed) };
    }

    /**
     * Graph processing latency (2.4d): the worst track's chain latency sum.
     * Computed from the nodes' LIVE declarations - never a constant.
     * Control thread (telemetry); the graph is immutable once active.
     */
    [[nodiscard]] uint32_t getLatencySamples() const noexcept {
        uint32_t worst = 0;
        for (const auto& track : tracks_) {
            uint32_t sum = 0;
            for (const auto& processor : track.chain) {
                sum += processor->getLatencySamples();
            }
            if (sum > worst) worst = sum;
        }
        return worst;
    }

private:
    std::vector<AudioTrack> tracks_;
    uint32_t sample_rate_ = 48000;
    uint32_t max_block_size_ = 512;

    // Scratch buffers for mixing (pre-allocated)
    std::vector<float> track_buffer_;
    std::vector<float> mix_buffer_;

    // Per-track peak meters (thread-safe)
    // Written by audio thread in processTrack, read by main thread in getMeters.
    // Using std::atomic<float> with memory_order_relaxed for both operations.
    // Relaxed ordering is sufficient: no synchronization needed, we just want
    // a recent-ish value for visual metering. No barriers, no cost.
    // A2 : automation du master (immuable une fois actif)
    std::vector<daw::document::AutomationLaneDef> master_automation_;

    // Preuve par etage : nul en live, pose par offline_render (--probe)
    StageProbe* probe_ = nullptr;

    // V1.2: master stage (atomics - sacred-thread rules)
    std::atomic<float> master_gain_{1.0f};
    std::atomic<float> master_peak_left_{0.0f};
    std::atomic<float> master_peak_right_{0.0f};

    // F5 : horloge de session libre + nombre de pistes ENGAGEES (slot lance OU
    // en file) - anyLaunched doit couvrir les files (le callback doit tourner
    // pour que la promotion arrive meme transport a l'arret).
    std::atomic<int64_t> session_clock_{0};
    std::atomic<int32_t> launched_count_{0};
    // Etape 0 : transport en lecture ? (thread audio seul, pas atomique)
    bool transport_playing_ = true;
    // Vague 3 : cible du MIDI live (control -> audio) + staging du sous-bloc
    // (thread audio seul) + memoire de routage pour l'all-notes-off.
    std::atomic<int32_t> live_midi_track_{-1};
    const daw::host::MidiEvent* live_midi_events_ = nullptr;
    uint32_t live_midi_count_ = 0;
    daw::midi::LiveMidiStats* live_midi_stats_ = nullptr;
    bool live_midi_prev_routed_ = false;
    ProcessorNode* live_midi_prev_inst_ = nullptr;
    // F5+ : epoque du quantum (horloge au lancement de l'ANCRE - le 1er slot
    // parti quand rien ne jouait) et quantum (loop_len de l'ancre). Remis a
    // zero implicitement : reposes au prochain lancement d'ancre.
    std::atomic<int64_t> session_epoch_{0};
    std::atomic<int64_t> session_quantum_{0};
    // T2 : quantum musical (doc v2), 0 = legacy. Lu par launchSlot a
    // l'ancre, ecrit par le control thread (setMusicalQuantum).
    std::atomic<int64_t> musical_quantum_{0};

    size_t num_tracks_ = 0;
    std::unique_ptr<std::atomic<float>[]> peak_left_;
    std::unique_ptr<std::atomic<float>[]> peak_right_;

    // Refonte T3 : pic par DEVICE (VU inter-device). Un tableau plat sur
    // toute la chaine de toutes les pistes ; track_chain_offset_[t] = index
    // global ou commence la chaine de la piste t. RT-safe (atomics pre-alloues
    // en prepare, ecrits par le thread audio apres chaque node, lus par
    // getMeters). Les ids sont les proc ids (le web mappe procId -> VU).
    size_t num_nodes_ = 0;
    std::vector<std::string> node_ids_;
    std::vector<size_t> track_chain_offset_;
    std::unique_ptr<std::atomic<float>[]> node_peak_left_;
    std::unique_ptr<std::atomic<float>[]> node_peak_right_;

    /**
     * Process a single track.
     *
     * @param track Track to process
     * @param output Output buffer
     * @param frame_count Number of frames
     * @param position_samples Timeline position
     * @param track_index Track index for metering
     */
    void processTrack(
        AudioTrack& track,
        float* output,
        uint32_t frame_count,
        int64_t position_samples,
        size_t track_index
    ) noexcept;
};

}  // namespace daw::graph
