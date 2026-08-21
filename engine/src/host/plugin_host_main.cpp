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

#include "public.sdk/source/vst/hosting/module.h"

#include <cstdint>
#include <cstdio>
#include <iostream>
#include <string>

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

}  // namespace

int main(int argc, char* argv[]) {
    if (argc != 3 || std::string(argv[1]) != "--enumerate") {
        std::cerr << "Usage: plugin_host --enumerate <path.vst3>" << std::endl;
        return 2;
    }
    const std::string path = argv[2];

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
