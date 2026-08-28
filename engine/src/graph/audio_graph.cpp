// SPDX-License-Identifier: GPL-3.0-or-later
#include "audio_graph.h"
#include "compressor_node.h"          // session 4.2: clone path
#include "delay_node.h"               // session 4.3: clone path
#include "drive_node.h"               // session 4.3: clone path
#include "eq3_node.h"                 // session 4.2: clone path
#include "utility_node.h"             // session 4.1: clone path
#include "../audio/audio_callback.h"  // for INTERNAL_BLOCK_SIZE

#include <algorithm>
#include <cmath>
#include <cstring>

// Verify that atomic<float> is lock-free on this platform.
// If this fails, the audio thread would use a hidden mutex.
static_assert(std::atomic<float>::is_always_lock_free,
    "std::atomic<float> must be lock-free for audio thread safety");

namespace daw::graph {

AudioGraph::AudioGraph() = default;
AudioGraph::~AudioGraph() = default;

// Manual moves: the V1.2 master atomics delete the defaulted ones
// (AudioTrack's mold - atomics are copied by value, relaxed).
AudioGraph::AudioGraph(AudioGraph&& other) noexcept
    : tracks_(std::move(other.tracks_))
    , sample_rate_(other.sample_rate_)
    , max_block_size_(other.max_block_size_)
    , track_buffer_(std::move(other.track_buffer_))
    , mix_buffer_(std::move(other.mix_buffer_))
    , master_automation_(std::move(other.master_automation_))
    , probe_(other.probe_)
    , master_gain_(other.master_gain_.load(std::memory_order_relaxed))
    , master_peak_left_(other.master_peak_left_.load(std::memory_order_relaxed))
    , master_peak_right_(other.master_peak_right_.load(std::memory_order_relaxed))
    , live_midi_track_(other.live_midi_track_.load(std::memory_order_relaxed))
    , num_tracks_(other.num_tracks_)
    , peak_left_(std::move(other.peak_left_))
    , peak_right_(std::move(other.peak_right_)) {}

AudioGraph& AudioGraph::operator=(AudioGraph&& other) noexcept {
    if (this != &other) {
        tracks_ = std::move(other.tracks_);
        sample_rate_ = other.sample_rate_;
        max_block_size_ = other.max_block_size_;
        track_buffer_ = std::move(other.track_buffer_);
        mix_buffer_ = std::move(other.mix_buffer_);
        master_automation_ = std::move(other.master_automation_);
        probe_ = other.probe_;
        master_gain_.store(other.master_gain_.load(std::memory_order_relaxed),
                           std::memory_order_relaxed);
        master_peak_left_.store(other.master_peak_left_.load(std::memory_order_relaxed),
                                std::memory_order_relaxed);
        master_peak_right_.store(other.master_peak_right_.load(std::memory_order_relaxed),
                                 std::memory_order_relaxed);
        live_midi_track_.store(other.live_midi_track_.load(std::memory_order_relaxed),
                               std::memory_order_relaxed);
        num_tracks_ = other.num_tracks_;
        peak_left_ = std::move(other.peak_left_);
        peak_right_ = std::move(other.peak_right_);
    }
    return *this;
}

bool AudioGraph::process(
    float* output,
    uint32_t frame_count,
    int64_t position_samples
) noexcept {
    // Guard against unprepared buffers
    if (track_buffer_.empty() || mix_buffer_.empty()) {
        std::memset(output, 0, frame_count * 2 * sizeof(float));
        return false;
    }

    // Assert: frame_count must not exceed buffer capacity
    // The callback loops in sub-blocks, so this should never fire
    const uint32_t max_frames = static_cast<uint32_t>(track_buffer_.size() / 2);
    if (frame_count > max_frames) {
        // This is a bug - the callback should never pass more than INTERNAL_BLOCK_SIZE
        std::memset(output, 0, frame_count * 2 * sizeof(float));
        return false;
    }

    // Clear output buffer
    std::memset(output, 0, frame_count * 2 * sizeof(float));

    if (tracks_.empty()) {
        // Master meters must SAY silence too (same lesson as clearMeters)
        master_peak_left_.store(0.0f, std::memory_order_relaxed);
        master_peak_right_.store(0.0f, std::memory_order_relaxed);
        return true;
    }

    // Check if any track is soloed
    bool has_solo = false;
    for (const auto& track : tracks_) {
        if (track.solo.load(std::memory_order_relaxed)) {
            has_solo = true;
            break;
        }
    }

    // Vague 3 : MIDI live -> instrument de la piste cible, AVANT la boucle
    // des pistes (le ProxyNode de la cible drainera ces evenements avec le
    // bloc qu'il depose ci-dessous). Offset 0 pour tous (v1 : gigue <= un
    // sous-bloc ; placement par timestamp = dette datee). Meme thread que
    // process() : la regle un-producteur-par-ring tient.
    {
        const int32_t target = live_midi_track_.load(std::memory_order_relaxed);
        ProcessorNode* inst = nullptr;
        bool routed = false;
        if (target >= 0 && target < static_cast<int32_t>(tracks_.size())) {
            const auto& t = tracks_[target];
            const bool audible =
                !t.mute.load(std::memory_order_relaxed) &&
                (!has_solo || t.solo.load(std::memory_order_relaxed));
            inst = t.instrument_node;
            routed = audible && inst != nullptr;
        }
        // Transition route -> non-route (mute, solo ailleurs, cible retiree) :
        // UN all-notes-off vers l'ancien instrument, sinon la note tenue au
        // moment du mute resterait bloquee et ressortirait a l'un-mute.
        if (live_midi_prev_routed_ && !routed && live_midi_prev_inst_) {
            live_midi_prev_inst_->allNotesOff();
        }
        live_midi_prev_routed_ = routed;
        live_midi_prev_inst_ = inst;
        if (live_midi_count_ > 0) {
            if (routed) {
                for (uint32_t k = 0; k < live_midi_count_; ++k) {
                    daw::host::MidiEvent ev = live_midi_events_[k];
                    ev.sample_offset = 0;
                    inst->emitMidiEvent(ev);
                }
                if (live_midi_stats_)
                    live_midi_stats_->forwarded.fetch_add(live_midi_count_,
                                                          std::memory_order_relaxed);
            } else if (live_midi_stats_) {
                live_midi_stats_->unrouted.fetch_add(live_midi_count_,
                                                     std::memory_order_relaxed);
            }
            live_midi_count_ = 0;
        }
    }

    // Process each track and mix
    for (size_t i = 0; i < tracks_.size(); ++i) {
        auto& track = tracks_[i];

        // Skip muted tracks
        if (track.mute.load(std::memory_order_relaxed)) {
            peak_left_[i] = 0.0f;
            peak_right_[i] = 0.0f;
            continue;
        }

        // If any track is soloed, skip non-soloed tracks
        if (has_solo && !track.solo.load(std::memory_order_relaxed)) {
            peak_left_[i] = 0.0f;
            peak_right_[i] = 0.0f;
            continue;
        }

        // Process track into track buffer
        processTrack(track, track_buffer_.data(), frame_count, position_samples, i);

        // Mix into output
        for (uint32_t j = 0; j < frame_count * 2; ++j) {
            output[j] += track_buffer_[j];
        }
    }

    // V1.2: master gain applied HERE - offline_render calls this same
    // process(), so live/offline parity is free (no twin). Multiplication
    // is UNCONDITIONAL: x1.0 is bit-exact in IEEE754, the reference hash
    // is safe by construction.
    // A2 : lane master 'gain' enabled > masterGain manuel.
    float master = master_gain_.load(std::memory_order_relaxed);
    if (auto v = laneValueFor(master_automation_, "gain", position_samples)) {
        master = mapGain(*v);
    }
    // Preuve par etage : le MIX avant master (la somme des pistes)
    if (probe_) probe_->feed("__master__", "mix", output, frame_count);
    float mpl = 0.0f;
    float mpr = 0.0f;
    for (uint32_t j = 0; j < frame_count; ++j) {
        const float l = output[j * 2] * master;
        const float r = output[j * 2 + 1] * master;
        output[j * 2] = l;
        output[j * 2 + 1] = r;
        const float al = l < 0.0f ? -l : l;
        const float ar = r < 0.0f ? -r : r;
        if (al > mpl) mpl = al;
        if (ar > mpr) mpr = ar;
    }
    master_peak_left_.store(mpl, std::memory_order_relaxed);
    master_peak_right_.store(mpr, std::memory_order_relaxed);
    // Preuve par etage : la SORTIE finale (post-masterGain)
    if (probe_) probe_->feed("__master__", "master", output, frame_count);

    return true;
}

void AudioGraph::processTrack(
    AudioTrack& track,
    float* output,
    uint32_t frame_count,
    int64_t position_samples,
    size_t track_index
) noexcept {
    // F5 : etat de launch de session (thread audio). Quand un slot est lance,
    // il PREND la piste : les clips de timeline se taisent et l'instrument joue
    // les notes BOUCLEES du slot au lieu de ses notes de timeline.
    // F5+ : PROMOTION des slots en file - si la frontiere de quantum tombe
    // dans ce bloc, le slot en file devient le slot lance ; le demarrage est
    // cale au sample par le saut d'emission plus bas. Course tolerée avec un
    // stop simultane du control thread : fenetre d'un bloc, echelle humaine.
    const int64_t clock = session_clock_.load(std::memory_order_relaxed);
    const int32_t queued = track.queued_slot.load(std::memory_order_acquire);
    if (queued >= 0) {
        const int64_t qs = track.queued_start.load(std::memory_order_relaxed);
        if (qs < clock + static_cast<int64_t>(frame_count)) {
            track.launch_clock.store(qs, std::memory_order_relaxed);
            track.launched_slot.store(queued, std::memory_order_release);
            track.queued_slot.store(-1, std::memory_order_release);
        }
    }
    const int32_t launched = track.launched_slot.load(std::memory_order_acquire);
    const bool session_active =
        launched >= 0 && launched < static_cast<int32_t>(track.session_slots.size()) &&
        track.instrument_node != nullptr;
    // Transition (launch / stop / changement de slot) -> all-notes-off pour ne
    // laisser aucune note bloquee de l'etat precedent.
    if (launched != track.prev_launched) {
        if (track.instrument_node) track.instrument_node->allNotesOff();
        track.prev_launched = launched;
    }

    // Clear track buffer
    std::memset(output, 0, frame_count * 2 * sizeof(float));

    // Etape 0 (Vague 3) : la timeline ne rend et n'emet QUE si le transport
    // joue - transport arrete (session lancee, MIDI live), la position est
    // gelee et rejouer le bloc serait un bourdon. Un slot lance prend aussi
    // la piste (F5).
    const bool timeline = transport_playing_ && !session_active;

    // Render all clips and mix (sautes si un slot de session a pris la piste
    // ou si le transport est arrete)
    if (timeline) {
        for (auto& clip : track.clips) {
            if (clip.isActiveAt(position_samples, frame_count)) {
                // Render clip into mix buffer
                clip.render(mix_buffer_.data(), frame_count, position_samples);

                // Mix into track output
                for (uint32_t i = 0; i < frame_count * 2; ++i) {
                    output[i] += mix_buffer_[i];
                }
            }
        }
    }

    // Preuve par etage (offline) : le signal APRES le mix des clips
    if (probe_) probe_->feed(track.id, "clips", output, frame_count);

    // Apply track gain (atomic load for thread-safe real-time updates)
    // A2 : une lane 'gain' enabled PRIME sur la valeur manuelle (design
    // section 2). Evaluation au premier sample du sous-bloc (256 frames),
    // f(position) pure -> parite live/offline et hash deterministe gratuits.
    float gain_value = track.gain.load(std::memory_order_relaxed);
    if (auto v = laneValueFor(track.automation, "gain", position_samples)) {
        gain_value = mapGain(*v);
    }
    for (uint32_t i = 0; i < frame_count * 2; ++i) {
        output[i] *= gain_value;
    }
    if (probe_) probe_->feed(track.id, "gain", output, frame_count);

    // F5 : notes de session bouclees vers l'instrument, AVANT la chaine (le
    // node draine son ring en process()). Le flag suppress coupe ses notes de
    // timeline ce bloc. Rebasage sur l'horloge de session (libre).
    if (track.instrument_node) {
        track.instrument_node->setSuppressTimelineNotes(!timeline);
    }
    if (session_active) {
        const SessionSlot& slot = track.session_slots[launched];
        const int64_t lc = track.launch_clock.load(std::memory_order_relaxed);
        ProcessorNode* inst = track.instrument_node;
        if (clock >= lc) {
            daw::host::emitSessionLoop(
                slot.notes, slot.loop_len, clock - lc, frame_count,
                [inst](bool on, uint8_t p, uint8_t v, uint32_t off) {
                    inst->emitMidi(on, p, v, off);
                });
        } else if (lc - clock < static_cast<int64_t>(frame_count)) {
            // F5+ : slot promu qui demarre DANS ce bloc - emission decalee au
            // sample exact de la frontiere de quantum (offset + skip).
            const uint32_t skip = static_cast<uint32_t>(lc - clock);
            daw::host::emitSessionLoop(
                slot.notes, slot.loop_len, 0, frame_count - skip,
                [inst, skip](bool on, uint8_t p, uint8_t v, uint32_t off) {
                    inst->emitMidi(on, p, v, off + skip);
                });
        }
    }

    // Process through chain, en mesurant le pic APRES CHAQUE device (T3 :
    // VU inter-device). Le tap est RT-safe (boucle de pic + store atomique).
    const size_t chain_off = track_index < track_chain_offset_.size()
                                 ? track_chain_offset_[track_index] : 0;
    size_t node_j = 0;
    for (auto& processor : track.chain) {
        processor->process(output, output, frame_count, position_samples);
        float npl = 0.0f, npr = 0.0f;
        for (uint32_t i = 0; i < frame_count; ++i) {
            const float al = std::fabs(output[i * 2]);
            const float ar = std::fabs(output[i * 2 + 1]);
            if (al > npl) npl = al;
            if (ar > npr) npr = ar;
        }
        const size_t gi = chain_off + node_j;
        if (gi < num_nodes_) {
            node_peak_left_[gi].store(npl, std::memory_order_relaxed);
            node_peak_right_[gi].store(npr, std::memory_order_relaxed);
        }
        // Preuve par etage : le signal APRES CE node (l'id du document -
        // le meme chez tous les pairs, donc les hash sont comparables)
        if (probe_) probe_->feed(track.id, processor->getId(), output, frame_count);
        ++node_j;
    }

    // F2 : panoramique en SORTIE de piste (post-chain). Post-chain
    // volontairement : un instrument (ex Dexed) IGNORE son entree et genere un
    // signal centre - le paner avant sa chaine ne ferait rien.
    //   Loi LINEAIRE centre-neutre (pas puissance egale) : le canal proche
    //   reste a l'unite, le canal oppose descend lineairement. Choix impose
    //   par la neutralite du CENTRE (pan 0 == inchange) - obligatoire pour ne
    //   pas alterer le hash offline deterministe ni la loudness des projets
    //   existants. La puissance egale mettrait le centre a -3 dB (casse les
    //   hash) ou le hard-pan a +3 dB (risque de clip) ET creerait une
    //   discontinuite de -3 dB en frolant le centre. gl,gr continus en 0.
    // pan -1 (G) .. 0 (centre) .. +1 (D). Le metering suit (post-pan).
    float pan_value = track.pan.load(std::memory_order_relaxed);
    // A2 : lane 'pan' enabled > pan manuel (0..1 -> -1..+1)
    if (auto v = laneValueFor(track.automation, "pan", position_samples)) {
        pan_value = mapPan(*v);
    }
    if (pan_value != 0.0f) {
        const float gl = pan_value <= 0.0f ? 1.0f : (1.0f - pan_value);
        const float gr = pan_value >= 0.0f ? 1.0f : (1.0f + pan_value);
        for (uint32_t i = 0; i < frame_count; ++i) {
            output[i * 2] *= gl;
            output[i * 2 + 1] *= gr;
        }
    }
    if (probe_) probe_->feed(track.id, "pan", output, frame_count);

    // Calculate peaks for metering
    float peak_l = 0.0f;
    float peak_r = 0.0f;
    for (uint32_t i = 0; i < frame_count; ++i) {
        const float abs_l = std::fabs(output[i * 2]);
        const float abs_r = std::fabs(output[i * 2 + 1]);
        if (abs_l > peak_l) peak_l = abs_l;
        if (abs_r > peak_r) peak_r = abs_r;
    }
    peak_left_[track_index].store(peak_l, std::memory_order_relaxed);
    peak_right_[track_index].store(peak_r, std::memory_order_relaxed);
}

void AudioGraph::prepare(uint32_t sample_rate, uint32_t max_block_size) {
    sample_rate_ = sample_rate;
    max_block_size_ = max_block_size;

    // Allocate scratch buffers for fixed internal block size only
    // The callback loops in sub-blocks of audio::INTERNAL_BLOCK_SIZE (256 frames)
    // No safety margin needed - we control the block size
    track_buffer_.resize(audio::INTERNAL_BLOCK_SIZE * audio::kChannelCount);
    mix_buffer_.resize(audio::INTERNAL_BLOCK_SIZE * audio::kChannelCount);

    // Allocate atomic peak meters
    num_tracks_ = tracks_.size();
    peak_left_ = std::make_unique<std::atomic<float>[]>(num_tracks_);
    peak_right_ = std::make_unique<std::atomic<float>[]>(num_tracks_);

    // Initialize to zero
    for (size_t i = 0; i < num_tracks_; ++i) {
        peak_left_[i].store(0.0f, std::memory_order_relaxed);
        peak_right_[i].store(0.0f, std::memory_order_relaxed);
    }

    // T3 : metrologie par DEVICE (VU inter-device). Table plate + offset/piste.
    node_ids_.clear();
    track_chain_offset_.clear();
    track_chain_offset_.reserve(tracks_.size());
    for (auto& track : tracks_) {
        track_chain_offset_.push_back(node_ids_.size());
        for (auto& processor : track.chain) {
            node_ids_.push_back(processor->getId());
        }
    }
    num_nodes_ = node_ids_.size();
    const size_t alloc_n = num_nodes_ ? num_nodes_ : 1;
    node_peak_left_ = std::make_unique<std::atomic<float>[]>(alloc_n);
    node_peak_right_ = std::make_unique<std::atomic<float>[]>(alloc_n);
    for (size_t i = 0; i < num_nodes_; ++i) {
        node_peak_left_[i].store(0.0f, std::memory_order_relaxed);
        node_peak_right_[i].store(0.0f, std::memory_order_relaxed);
    }

    // Prepare all processors
    for (auto& track : tracks_) {
        for (auto& processor : track.chain) {
            processor->prepare(sample_rate, max_block_size);
        }
    }
}

void AudioGraph::reset() noexcept {
    for (auto& track : tracks_) {
        for (auto& clip : track.clips) {
            clip.reset();
        }
        for (auto& processor : track.chain) {
            processor->reset();
        }
    }

    // Clear peaks (atomic)
    for (size_t i = 0; i < num_tracks_; ++i) {
        peak_left_[i].store(0.0f, std::memory_order_relaxed);
        peak_right_[i].store(0.0f, std::memory_order_relaxed);
    }
}

void AudioGraph::addTrack(AudioTrack track) {
    // Note: peak arrays are allocated in prepare() after all tracks are added
    tracks_.push_back(std::move(track));
}

AudioTrack* AudioGraph::getTrackById(const std::string& id) noexcept {
    for (auto& track : tracks_) {
        if (track.id == id) {
            return &track;
        }
    }
    return nullptr;
}

ProcessorNode* AudioGraph::getNodeById(const std::string& id) noexcept {
    // v9 : lookup node de chaine par proc id (fenetre GUI a la demande). Le
    // graphe est immuable une fois actif ; le control thread le sonde via le
    // slot atomique. Lineaire sur les chaines (peu de nodes) - pas de map.
    for (auto& track : tracks_) {
        for (auto& node : track.chain) {
            if (node && node->getId() == id) {
                return node.get();
            }
        }
    }
    return nullptr;
}

bool AudioGraph::launchSlot(const std::string& track_id,
                            const std::string& scene_id, bool stop,
                            bool quantize) noexcept {
    // F5 : control thread (message launch). Le graphe est immuable une fois
    // actif ; on ne touche que les atomics de launch de la piste.
    AudioTrack* track = getTrackById(track_id);
    if (!track) return false;
    const int32_t prev = track->launched_slot.load(std::memory_order_relaxed);
    const int32_t prev_q = track->queued_slot.load(std::memory_order_relaxed);
    const bool was_engaged = prev >= 0 || prev_q >= 0;
    // Le slot appartient-il a scene_id ? (scene vide = toutes)
    const auto inScene = [&](int32_t idx) {
        return scene_id.empty() ||
               (idx >= 0 && idx < static_cast<int32_t>(track->session_slots.size()) &&
                track->session_slots[idx].scene_id == scene_id);
    };
    if (stop) {
        // F5+ : stop FILTRE par scene (scene vide = stop inconditionnel).
        // File d'abord, puis lance (l'ordre reduit la fenetre de course avec
        // la promotion du thread audio - voir processTrack).
        bool engaged_after = false;
        if (prev_q >= 0) {
            if (inScene(prev_q)) track->queued_slot.store(-1, std::memory_order_release);
            else engaged_after = true;
        }
        if (prev >= 0) {
            if (inScene(prev)) track->launched_slot.store(-1, std::memory_order_release);
            else engaged_after = true;
        }
        if (was_engaged && !engaged_after) {
            launched_count_.fetch_sub(1, std::memory_order_relaxed);
        }
        return true;
    }
    int32_t idx = -1;
    for (size_t i = 0; i < track->session_slots.size(); ++i) {
        if (track->session_slots[i].scene_id == scene_id) {
            idx = static_cast<int32_t>(i);
            break;
        }
    }
    if (idx < 0) return false;  // pas de slot pour cette scene sur cette piste
    const int64_t now = session_clock_.load(std::memory_order_relaxed);
    const bool anchor = launched_count_.load(std::memory_order_relaxed) == 0;
    if (anchor) {
        // F5+ : l'ancre part immediatement et POSE la grille (epoque +
        // quantum = son loop_len). quantize sans reference n'a pas de sens.
        // T2 : doc v2 -> le quantum est MUSICAL (1 mesure au registre),
        // echantillonne ICI (au launch) ; 0 = legacy, loop_len.
        const int64_t mq = musical_quantum_.load(std::memory_order_relaxed);
        session_epoch_.store(now, std::memory_order_relaxed);
        session_quantum_.store(
            mq > 0 ? mq : track->session_slots[idx].loop_len,
            std::memory_order_relaxed);
    }
    if (!anchor && quantize) {
        // En FILE pour la prochaine frontiere ; le slot courant (s'il y en a
        // un) continue jusqu'a la promotion par le thread audio.
        const int64_t start = nextQuantumStart(
            now, session_epoch_.load(std::memory_order_relaxed),
            session_quantum_.load(std::memory_order_relaxed));
        track->queued_start.store(start, std::memory_order_relaxed);
        track->queued_slot.store(idx, std::memory_order_release);
    } else {
        // launch_clock AVANT launched_slot (release) : le thread audio lit
        // launched_slot (acquire) puis launch_clock -> rebasage coherent.
        track->queued_slot.store(-1, std::memory_order_relaxed);
        track->launch_clock.store(now, std::memory_order_relaxed);
        track->launched_slot.store(idx, std::memory_order_release);
    }
    if (!was_engaged) launched_count_.fetch_add(1, std::memory_order_relaxed);
    return true;
}

std::vector<std::tuple<std::string, std::string, bool>>
AudioGraph::getSessionState() const noexcept {
    // F5+ : verite des slots pour la telemetrie (control thread, atomics
    // relaxed - une coherence de l'ordre du bloc suffit a l'UI).
    std::vector<std::tuple<std::string, std::string, bool>> out;
    for (const auto& track : tracks_) {
        const int32_t launched = track.launched_slot.load(std::memory_order_relaxed);
        const int32_t queued = track.queued_slot.load(std::memory_order_relaxed);
        const auto scene = [&](int32_t idx) -> const std::string& {
            static const std::string kEmpty;
            return (idx >= 0 && idx < static_cast<int32_t>(track.session_slots.size()))
                       ? track.session_slots[idx].scene_id : kEmpty;
        };
        if (launched >= 0) out.emplace_back(track.id, scene(launched), false);
        if (queued >= 0) out.emplace_back(track.id, scene(queued), true);
    }
    return out;
}

std::vector<std::tuple<std::string, float, float>> AudioGraph::getMeters() const noexcept {
    std::vector<std::tuple<std::string, float, float>> meters;
    meters.reserve(tracks_.size());

    for (size_t i = 0; i < num_tracks_; ++i) {
        meters.emplace_back(
            tracks_[i].id,
            peak_left_[i].load(std::memory_order_relaxed),
            peak_right_[i].load(std::memory_order_relaxed)
        );
    }

    // T3 : pic par DEVICE (id = proc id) - le web mappe procId -> VU.
    for (size_t k = 0; k < num_nodes_; ++k) {
        meters.emplace_back(
            node_ids_[k],
            node_peak_left_[k].load(std::memory_order_relaxed),
            node_peak_right_[k].load(std::memory_order_relaxed)
        );
    }

    return meters;
}

}  // namespace daw::graph
