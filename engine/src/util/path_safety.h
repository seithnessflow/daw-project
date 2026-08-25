// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include <string>

namespace daw::util {

/**
 * AUDIT-5 B5: a document string used as a FILESYSTEM path component - an
 * asset/state/stem hash, or a node id used in a temp filename - must not let
 * a hostile peer escape the assets dir. In a collaborative project the
 * document is attacker-controllable (same doctrine as the web's sanitize.ts
 * and the server's valid_project_id): the engine is the stage with write
 * access, and it joined these strings into paths WITHOUT any check.
 *
 * Reject a path separator, a parent ref, a control char, or empty. Otherwise
 * DELIBERATELY permissive: real sha256 hex keys, and the short hex/text
 * placeholders the tests use, all pass. The goal is to block traversal, not
 * to enforce a hash format (legacy FNV keys and test placeholders must live).
 */
[[nodiscard]] inline bool isPathComponentSafe(const std::string& s) {
    if (s.empty()) {
        return false;
    }
    if (s.find('/') != std::string::npos || s.find('\\') != std::string::npos) {
        return false;
    }
    if (s.find("..") != std::string::npos) {
        return false;
    }
    for (const unsigned char c : s) {
        if (c < 0x20) {  // control chars, incl. NUL/CR/LF (header injection)
            return false;
        }
    }
    return true;
}

}  // namespace daw::util
