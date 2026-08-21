// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @file plugin_host_main.cpp
 * @brief VST3 plugin host - child process (ADR-017).
 *
 * 2.4a scope: `plugin_host --enumerate <path.vst3>` loads the module,
 * enumerates the factory classes and writes ONE length-prefixed
 * daw.host.HostResponse to stdout (binary), then exits. Human-readable
 * diagnostics go to stderr. A bad or corrupt module must produce a clean
 * error and a non-zero exit code - never a crash of the host: crashing on
 * hostile modules is precisely what this child process exists to absorb
 * instead of the engine.
 *
 * VST3::Hosting::Module encapsulates the platform ritual (bundle folder
 * vs legacy DLL, InitDll() before GetPluginFactory(), ExitDll() on
 * destruction).
 */

#include "host_messages.pb.h"

#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"

#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

// Same framing as the browser protocol: 4-byte big-endian length prefix
bool writeResponse(const daw::host::HostResponse& resp) {
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    std::string payload;
    if (!resp.SerializeToString(&payload)) {
        return false;
    }
    const uint32_t len = static_cast<uint32_t>(payload.size());
    const unsigned char prefix[4] = {
        static_cast<unsigned char>((len >> 24) & 0xFF),
        static_cast<unsigned char>((len >> 16) & 0xFF),
        static_cast<unsigned char>((len >> 8) & 0xFF),
        static_cast<unsigned char>(len & 0xFF),
    };
    if (std::fwrite(prefix, 1, 4, stdout) != 4) return false;
    if (len > 0 && std::fwrite(payload.data(), 1, len, stdout) != len) return false;
    std::fflush(stdout);
    return true;
}

// Windows error strings arrive in the ANSI codepage (e.g. CP1252 accents):
// invalid UTF-8, which protobuf refuses to serialize. Keep ASCII, replace
// the rest - the message stays legible, the protocol stays valid.
std::string toProtoSafe(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (const unsigned char c : s) {
        out.push_back((c < 0x80) ? static_cast<char>(c) : '?');
    }
    return out;
}

int fail(daw::host::HostResponse& resp, const std::string& error) {
    auto* enu = resp.mutable_enumerate();
    enu->set_ok(false);
    enu->set_error(toProtoSafe(error));
    std::cerr << "plugin_host error: " << error << std::endl;
    writeResponse(resp);
    return 1;
}

// ---- Minimal 16-bit stereo WAV I/O -----------------------------------------
// Symmetric 1/32768 scale on both directions: float(s)=s/32768,
// int16(f)=f*32768 (clamped). Every 16-bit value is exact in float, so a
// gain of 1.0 is a bit-exact identity and 0.5 (a power of two) is exact too.

bool readWav16Stereo(const std::string& path, std::vector<int16_t>& samples, uint32_t& sample_rate) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    std::vector<char> buf((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    if (buf.size() < 12 || std::memcmp(buf.data(), "RIFF", 4) != 0) return false;

    uint16_t channels = 0, bits = 0;
    size_t off = 12;
    while (off + 8 <= buf.size()) {
        const std::string id(buf.data() + off, 4);
        uint32_t size;
        std::memcpy(&size, buf.data() + off + 4, 4);
        if (id == "fmt " && size >= 16) {
            std::memcpy(&channels, buf.data() + off + 10, 2);
            std::memcpy(&sample_rate, buf.data() + off + 12, 4);
            std::memcpy(&bits, buf.data() + off + 22, 2);
        } else if (id == "data") {
            if (channels != 2 || bits != 16) return false;
            const size_t count = size / 2;
            samples.resize(count);
            if (off + 8 + size > buf.size()) return false;
            std::memcpy(samples.data(), buf.data() + off + 8, count * 2);
            return true;
        }
        off += 8 + size + (size % 2);
    }
    return false;
}

bool writeWav16Stereo(const std::string& path, const std::vector<int16_t>& samples, uint32_t sample_rate) {
    std::ofstream f(path, std::ios::binary);
    if (!f) return false;
    const uint32_t data_size = static_cast<uint32_t>(samples.size() * 2);
    const uint32_t chunk = 36 + data_size, fmt = 16, byte_rate = sample_rate * 4;
    const uint16_t pcm = 1, ch = 2, align = 4, bits = 16;
    f.write("RIFF", 4); f.write(reinterpret_cast<const char*>(&chunk), 4);
    f.write("WAVE", 4); f.write("fmt ", 4);
    f.write(reinterpret_cast<const char*>(&fmt), 4);
    f.write(reinterpret_cast<const char*>(&pcm), 2);
    f.write(reinterpret_cast<const char*>(&ch), 2);
    f.write(reinterpret_cast<const char*>(&sample_rate), 4);
    f.write(reinterpret_cast<const char*>(&byte_rate), 4);
    f.write(reinterpret_cast<const char*>(&align), 2);
    f.write(reinterpret_cast<const char*>(&bits), 2);
    f.write("data", 4); f.write(reinterpret_cast<const char*>(&data_size), 4);
    f.write(reinterpret_cast<const char*>(samples.data()), data_size);
    return f.good();
}

// ---- Process mode (2.4b) ---------------------------------------------------
// The full VST3 instantiation ceremony, in order; EVERY refusal is a clean
// error in the ProcessResult, never a crash. Fixed 256-sample blocks: the
// engine's INTERNAL_BLOCK_SIZE becomes a formal contract with third-party
// code here. Parameters go through IParameterChanges - the same channel the
// document's chain will drive in 2.4c.

constexpr int32_t kHostBlockSize = 256;

int failProcess(daw::host::HostResponse& resp, const std::string& error) {
    auto* pr = resp.mutable_process();
    pr->set_ok(false);
    pr->set_error(toProtoSafe(error));
    std::cerr << "plugin_host error: " << error << std::endl;
    writeResponse(resp);
    return 1;
}

int runProcess(const std::string& module_path, const std::string& uid_str,
               bool has_param, uint32_t param_id, double param_value,
               const std::string& in_path, const std::string& out_path) {
    using namespace Steinberg;
    daw::host::HostResponse resp;

    std::vector<int16_t> in_samples;
    uint32_t sample_rate = 0;
    if (!readWav16Stereo(in_path, in_samples, sample_rate)) {
        return failProcess(resp, "cannot read 16-bit stereo WAV: " + in_path);
    }

    std::string err;
    auto module = VST3::Hosting::Module::create(module_path, err);
    if (!module) {
        return failProcess(resp, err.empty() ? "failed to load module" : err);
    }

    auto uid = VST3::UID::fromString(uid_str);
    if (!uid) {
        return failProcess(resp, "invalid class uid: " + uid_str);
    }

    auto component = module->getFactory().createInstance<Vst::IComponent>(*uid);
    if (!component) {
        return failProcess(resp, "createInstance refused (uid not an instantiable audio component)");
    }

    Vst::HostApplication host_app;
    if (component->initialize(&host_app) != kResultOk) {
        return failProcess(resp, "IComponent::initialize refused");
    }

    FUnknownPtr<Vst::IAudioProcessor> processor(component);
    if (!processor) {
        component->terminate();
        return failProcess(resp, "component exposes no IAudioProcessor");
    }

    Vst::SpeakerArrangement stereo = Vst::SpeakerArr::kStereo;
    if (processor->setBusArrangements(&stereo, 1, &stereo, 1) != kResultOk) {
        component->terminate();
        return failProcess(resp, "setBusArrangements(stereo/stereo) refused");
    }

    Vst::ProcessSetup setup{};
    setup.processMode = Vst::kRealtime;
    setup.symbolicSampleSize = Vst::kSample32;
    setup.maxSamplesPerBlock = kHostBlockSize;
    setup.sampleRate = static_cast<double>(sample_rate);
    if (processor->setupProcessing(setup) != kResultOk) {
        component->terminate();
        return failProcess(resp, "setupProcessing refused");
    }

    if (component->activateBus(Vst::kAudio, Vst::kInput, 0, true) != kResultOk ||
        component->activateBus(Vst::kAudio, Vst::kOutput, 0, true) != kResultOk) {
        component->terminate();
        return failProcess(resp, "activateBus refused");
    }

    if (component->setActive(true) != kResultOk) {
        component->terminate();
        return failProcess(resp, "setActive refused");
    }

    std::vector<float> in_l(kHostBlockSize), in_r(kHostBlockSize);
    std::vector<float> out_l(kHostBlockSize), out_r(kHostBlockSize);
    float* in_ch[2] = {in_l.data(), in_r.data()};
    float* out_ch[2] = {out_l.data(), out_r.data()};

    Vst::AudioBusBuffers in_bus{};
    in_bus.numChannels = 2;
    in_bus.channelBuffers32 = in_ch;
    Vst::AudioBusBuffers out_bus{};
    out_bus.numChannels = 2;
    out_bus.channelBuffers32 = out_ch;

    const size_t total_frames = in_samples.size() / 2;
    std::vector<int16_t> out_samples(total_frames * 2);
    uint32_t blocks = 0;
    size_t frame = 0;
    bool param_sent = false;

    while (frame < total_frames) {
        const int32_t n = static_cast<int32_t>(
            std::min<size_t>(kHostBlockSize, total_frames - frame));

        for (int32_t i = 0; i < n; ++i) {
            in_l[i] = static_cast<float>(in_samples[(frame + i) * 2]) / 32768.0f;
            in_r[i] = static_cast<float>(in_samples[(frame + i) * 2 + 1]) / 32768.0f;
            out_l[i] = 0.0f;
            out_r[i] = 0.0f;
        }

        Vst::ParameterChanges param_changes;
        param_changes.setMaxParameters(1);
        if (has_param && !param_sent) {
            int32 queue_index = 0;
            auto* queue = param_changes.addParameterData(param_id, queue_index);
            if (queue) {
                int32 point_index = 0;
                queue->addPoint(0, param_value, point_index);
            }
            param_sent = true;
        }

        Vst::ProcessData data{};
        data.processMode = Vst::kRealtime;
        data.symbolicSampleSize = Vst::kSample32;
        data.numSamples = n;
        data.numInputs = 1;
        data.numOutputs = 1;
        data.inputs = &in_bus;
        data.outputs = &out_bus;
        data.inputParameterChanges = &param_changes;

        if (processor->process(data) != kResultOk) {
            component->setActive(false);
            component->terminate();
            return failProcess(resp, "process refused at block " + std::to_string(blocks));
        }

        for (int32_t i = 0; i < n; ++i) {
            const float l = std::clamp(out_l[i] * 32768.0f, -32768.0f, 32767.0f);
            const float r = std::clamp(out_r[i] * 32768.0f, -32768.0f, 32767.0f);
            out_samples[(frame + i) * 2] = static_cast<int16_t>(l);
            out_samples[(frame + i) * 2 + 1] = static_cast<int16_t>(r);
        }

        frame += n;
        ++blocks;
    }

    component->setActive(false);
    component->terminate();

    if (!writeWav16Stereo(out_path, out_samples, sample_rate)) {
        return failProcess(resp, "cannot write output WAV: " + out_path);
    }

    auto* pr = resp.mutable_process();
    pr->set_ok(true);
    pr->set_frames_processed(total_frames);
    pr->set_blocks(blocks);
    std::cerr << "processed " << total_frames << " frames in " << blocks << " blocks" << std::endl;
    return writeResponse(resp) ? 0 : 1;
}

}  // namespace

int runEnumerate(const std::string& path);

int main(int argc, char* argv[]) {
    const std::string mode = (argc >= 2) ? argv[1] : "";

    if (mode == "--enumerate" && argc == 3) {
        return runEnumerate(argv[2]);
    }

    if (mode == "--process") {
        std::string module_path, uid, in_path, out_path;
        bool has_param = false;
        uint32_t param_id = 0;
        double param_value = 0.0;
        bool args_ok = (argc >= 3);
        if (args_ok) module_path = argv[2];
        for (int i = 3; i + 1 < argc && args_ok; i += 2) {
            const std::string a = argv[i];
            const std::string v = argv[i + 1];
            if (a == "--uid") uid = v;
            else if (a == "--in") in_path = v;
            else if (a == "--out") out_path = v;
            else if (a == "--param") {
                const auto colon = v.find(':');
                if (colon == std::string::npos) { args_ok = false; break; }
                param_id = static_cast<uint32_t>(std::stoul(v.substr(0, colon)));
                param_value = std::stod(v.substr(colon + 1));
                has_param = true;
            } else args_ok = false;
        }
        if (args_ok && !uid.empty() && !in_path.empty() && !out_path.empty()) {
            return runProcess(module_path, uid, has_param, param_id, param_value,
                              in_path, out_path);
        }
    }

    std::cerr << "Usage:\n"
              << "  plugin_host --enumerate <path.vst3>\n"
              << "  plugin_host --process <path.vst3> --uid <hex32> --in <in.wav> --out <out.wav> [--param <id>:<norm>]"
              << std::endl;
    return 2;
}

int runEnumerate(const std::string& path) {

    daw::host::HostResponse resp;

    std::string error;
    auto module = VST3::Hosting::Module::create(path, error);
    if (!module) {
        return fail(resp, error.empty() ? "Failed to load module: " + path : error);
    }

    auto* enu = resp.mutable_enumerate();
    enu->set_module_path(path);

    const auto& factory = module->getFactory();
    for (const auto& info : factory.classInfos()) {
        auto* c = enu->add_classes();
        c->set_name(info.name());
        c->set_category(info.category());
        c->set_class_id(info.ID().toString());
        c->set_vendor(info.vendor());
        c->set_version(info.version());
        c->set_sub_categories(info.subCategoriesString());
        std::cerr << "class: " << info.name() << " [" << info.category()
                  << "] uid=" << info.ID().toString() << std::endl;
    }

    enu->set_ok(true);
    if (!writeResponse(resp)) {
        std::cerr << "plugin_host error: failed to write response" << std::endl;
        return 1;
    }
    return 0;
}
