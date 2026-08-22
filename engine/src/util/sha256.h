// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file sha256.h
 * @brief Self-contained SHA-256 (FIPS 180-4) - no external dependency.
 *
 * 2.3a: assetHash becomes what SCHEMA.md always claimed. One portable
 * implementation for both toolchains (a CNG/OpenSSL split would be twins);
 * verified against the FIPS test vectors in the engine suite. Streaming
 * API so multi-MB assets never load twice just to be hashed.
 */

#include <cstddef>
#include <cstdint>
#include <string>

namespace daw::util {

class Sha256 {
public:
    Sha256();
    void update(const void* data, size_t len);
    /** Finalize and return lowercase hex (64 chars). Object is spent. */
    std::string finishHex();

private:
    void transform(const uint8_t block[64]);

    uint32_t state_[8];
    uint64_t bitlen_ = 0;
    uint8_t buffer_[64];
    size_t buffer_len_ = 0;
};

/** SHA-256 of a memory buffer, lowercase hex. */
std::string sha256Hex(const void* data, size_t len);

/** SHA-256 of a file's CONTENTS, lowercase hex; empty string on I/O error. */
std::string sha256HexFile(const std::string& path);

}  // namespace daw::util
