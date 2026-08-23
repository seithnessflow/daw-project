// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file state_file.h
 * @brief The `<segment>.state` side-channel file format (2.5-etat).
 *
 * SHARED between engine (plugin_bridge) and plugin_host - the format is
 * a contract between two executables, so it lives in exactly one place
 * (the twins rule; the ring header is the same mold).
 *
 * Layout: [u32le compLen][comp bytes][u32le contLen][cont bytes].
 * The controller section is reserved (the host instantiates no
 * IEditController yet) but part of the format from day one.
 */

#include <cstdint>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

namespace daw::host {

inline bool writeStateFile(const std::string& path,
                           const std::vector<uint8_t>& comp) {
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    if (!f) return false;
    const uint32_t comp_len = static_cast<uint32_t>(comp.size());
    const uint32_t cont_len = 0;
    f.write(reinterpret_cast<const char*>(&comp_len), 4);
    f.write(reinterpret_cast<const char*>(comp.data()),
            static_cast<std::streamsize>(comp.size()));
    f.write(reinterpret_cast<const char*>(&cont_len), 4);
    return f.good();
}

inline bool readStateFile(const std::string& path, std::vector<uint8_t>& comp) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    uint32_t comp_len = 0;
    f.read(reinterpret_cast<char*>(&comp_len), 4);
    if (!f || comp_len > (64u << 20)) return false;  // 64 MB sanity bound
    comp.resize(comp_len);
    f.read(reinterpret_cast<char*>(comp.data()), comp_len);
    return f.good() || comp_len == 0;
}

}  // namespace daw::host
