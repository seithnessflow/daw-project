// SPDX-License-Identifier: GPL-3.0-or-later
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

#include "audio_device.h"
#include "audio_callback.h"

#include <stdexcept>
#include <algorithm>
#include <cstring>
#include <iostream>

namespace daw::audio {

// Callback for device enumeration
static ma_bool32 enumerateCallback(
    ma_context* pContext,
    ma_device_type deviceType,
    const ma_device_info* pDeviceInfo,
    void* pUserData
) {
    (void)pContext;
    if (deviceType != ma_device_type_playback) {
        return MA_TRUE;  // Skip non-playback devices
    }

    auto* devices = static_cast<std::vector<AudioDeviceInfo>*>(pUserData);
    AudioDeviceInfo info;
    info.name = pDeviceInfo->name;
    info.is_default = pDeviceInfo->isDefault != 0;
    devices->push_back(info);

    return MA_TRUE;  // Continue enumeration
}

std::vector<AudioDeviceInfo> listPlaybackDevices() {
    std::vector<AudioDeviceInfo> devices;

    ma_context context;
    if (ma_context_init(nullptr, 0, nullptr, &context) != MA_SUCCESS) {
        return devices;
    }

    ma_context_enumerate_devices(&context, enumerateCallback, &devices);
    ma_context_uninit(&context);

    return devices;
}

// External thread-local context used by callback
extern thread_local AudioCallbackContext* g_callback_context;

// miniaudio callback wrapper
static void miniaudioCallback(
    ma_device* device,
    void* output,
    const void* input,
    ma_uint32 frame_count
) {
    // Set thread-local context from device user data
    g_callback_context = static_cast<AudioCallbackContext*>(device->pUserData);

    // Call our audio callback
    audioCallback(device, output, input, frame_count);
}

AudioDevice::AudioDevice()
    : context_(std::make_unique<ma_context>())
    , device_(std::make_unique<ma_device>())
{
}

AudioDevice::~AudioDevice() {
    shutdown();
}

bool AudioDevice::initialize(const AudioDeviceConfig& config) {
    if (state_ != AudioDeviceState::Uninitialized) {
        return false;
    }

    // Initialize context (optionally with null backend for silent testing)
    ma_context_config context_config = ma_context_config_init();
    ma_backend backends[1] = { ma_backend_null };

    ma_result result;
    if (config.use_null_backend) {
        result = ma_context_init(backends, 1, &context_config, context_.get());
    } else {
        result = ma_context_init(nullptr, 0, &context_config, context_.get());
    }

    if (result != MA_SUCCESS) {
        state_ = AudioDeviceState::Error;
        return false;
    }

    // Find device by name if specified
    ma_device_id* selected_device_id = nullptr;
    ma_device_id found_device_id;

    if (!config.device_name.empty() && !config.use_null_backend) {
        ma_device_info* playback_infos;
        ma_uint32 playback_count;
        ma_device_info* capture_infos;
        ma_uint32 capture_count;

        if (ma_context_get_devices(context_.get(), &playback_infos, &playback_count,
                                   &capture_infos, &capture_count) == MA_SUCCESS) {
            for (ma_uint32 i = 0; i < playback_count; ++i) {
                // Case-insensitive substring match
                std::string dev_name = playback_infos[i].name;
                std::string search_name = config.device_name;

                // Convert to lowercase for comparison
                std::transform(dev_name.begin(), dev_name.end(), dev_name.begin(), ::tolower);
                std::transform(search_name.begin(), search_name.end(), search_name.begin(), ::tolower);

                if (dev_name.find(search_name) != std::string::npos) {
                    found_device_id = playback_infos[i].id;
                    selected_device_id = &found_device_id;
                    break;
                }
            }
        }
    }

    // Configure device
    ma_device_config device_config = ma_device_config_init(ma_device_type_playback);
    device_config.playback.format = ma_format_f32;
    device_config.playback.channels = 2;  // Stereo
    device_config.playback.pDeviceID = selected_device_id;  // nullptr = default device
    device_config.sampleRate = config.sample_rate;
    device_config.periodSizeInFrames = config.buffer_size_frames;
    device_config.dataCallback = miniaudioCallback;

    // Set up callback context
    callback_context_.command_buffer = &command_buffer_;
    callback_context_.telemetry_buffer = &telemetry_buffer_;
    callback_context_.active_graph = &active_graph_raw_;
    callback_context_.callback_generation = &callback_generation_;
    callback_context_.transport = &transport_;
    callback_context_.buffer_underrun_count = &buffer_underrun_count_;
    callback_context_.sample_rate = config.sample_rate;

    device_config.pUserData = &callback_context_;

    // Initialize device
    if (ma_device_init(context_.get(), &device_config, device_.get()) != MA_SUCCESS) {
        ma_context_uninit(context_.get());
        state_ = AudioDeviceState::Error;
        return false;
    }

    // Get actual values (may differ from requested)
    actual_sample_rate_ = device_->sampleRate;
    actual_buffer_size_ = device_->playback.internalPeriodSizeInFrames;
    callback_context_.sample_rate = actual_sample_rate_;

    // SPIKE LATENCE (2026-08-27) : la VERITE de la negociation, en clair -
    // periode interne, nombre de periodes, et la latence de sortie que ca
    // implique. C'est la ligne que le tableau du spike lit.
    std::cerr << "audio-negotiation: requested=" << config.buffer_size_frames
              << " actual-period=" << actual_buffer_size_
              << " periods=" << device_->playback.internalPeriods
              << " rate=" << actual_sample_rate_
              << " -> device-latency~"
              << (1000.0 * actual_buffer_size_ *
                  device_->playback.internalPeriods / actual_sample_rate_)
              << " ms\n";

    // AUDIT-5 A6: a device period that is not a multiple of the 256-frame
    // internal block makes the plugin proxy bypass the partial chunk - that
    // audio goes DRY, silently, while telemetry only says "plugin late". A
    // real WASAPI shared-mode period (e.g. 480) hits this. Be loud (the real
    // fix - handle partial chunks / clamp depth from the true period - is a
    // dedicated session).
    if (actual_buffer_size_ % INTERNAL_BLOCK_SIZE != 0) {
        std::cerr << "WARNING: device period " << actual_buffer_size_
                  << " frames is not a multiple of " << INTERNAL_BLOCK_SIZE
                  << " - plugins bypass the partial chunk (silently dry). "
                     "Prefer a power-of-two buffer. AUDIT-5 A6.\n";
    }

    // Get device name
    char name[256];
    if (ma_device_get_name(device_.get(), ma_device_type_playback, name, sizeof(name), nullptr) == MA_SUCCESS) {
        device_name_ = name;
    } else {
        device_name_ = "Unknown Device";
    }

    state_ = AudioDeviceState::Initialized;
    return true;
}

void AudioDevice::shutdown() {
    if (state_ == AudioDeviceState::Uninitialized) {
        return;
    }

    stop();

    ma_device_uninit(device_.get());
    ma_context_uninit(context_.get());

    state_ = AudioDeviceState::Uninitialized;
}

bool AudioDevice::start() {
    if (state_ != AudioDeviceState::Initialized && state_ != AudioDeviceState::Stopped) {
        return false;
    }

    if (ma_device_start(device_.get()) != MA_SUCCESS) {
        state_ = AudioDeviceState::Error;
        return false;
    }

    state_ = AudioDeviceState::Running;
    return true;
}

void AudioDevice::stop() {
    if (state_ != AudioDeviceState::Running) {
        return;
    }

    ma_device_stop(device_.get());
    state_ = AudioDeviceState::Stopped;
}

bool AudioDevice::sendCommand(const AudioCommandMessage& cmd) {
    return command_buffer_.push(cmd);
}

std::optional<AudioTelemetry> AudioDevice::pollTelemetry() {
    return telemetry_buffer_.pop();
}

AudioDevice::RetiredGraph AudioDevice::setActiveGraph(std::shared_ptr<graph::AudioGraph> graph) {
    graph::AudioGraph* raw = graph.get();

    // Control-side readers first, then the audio slot; the generation
    // snapshot MUST be taken after the raw exchange (seq_cst, paired with
    // the callback's seq_cst entry increment - see GenGuard).
    auto old_sp = active_graph_.exchange(std::move(graph), std::memory_order_acq_rel);
    active_graph_raw_.exchange(raw, std::memory_order_seq_cst);
    const uint64_t gen = callback_generation_.load(std::memory_order_seq_cst);

    return RetiredGraph{std::move(old_sp), gen};
}

bool AudioDevice::isRetireSafe(const RetiredGraph& r) const {
    if (state_ != AudioDeviceState::Running) {
        return true;  // No callback can be running
    }
    if (r.gen_at_swap % 2 == 0) {
        return true;  // No callback was in flight at the swap
    }
    // A callback was in flight: wait until it has exited
    return callback_generation_.load(std::memory_order_acquire) > r.gen_at_swap;
}

}  // namespace daw::audio
