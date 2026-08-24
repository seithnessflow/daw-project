// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

/**
 * @file crash_handler.h
 * @brief Last-words crash logging (hunt for the 0xc0000409 fail-fast).
 *
 * Three identical silent deaths in one night (ucrtbase abort, same
 * offset, ~2 h into an AUDIBLE run) left ZERO trace in our logs - the
 * CRT fail-fast path bypasses stderr. This installs every last-chance
 * hook the CRT offers and writes a crash-<pid>.log next to the exe
 * with the reason and a raw stack (module+offset per frame - enough
 * to map against the binary even without PDBs).
 *
 * The handlers do the MINIMUM: open, write, flush, die. No allocation
 * beyond stack buffers where avoidable; reentry guarded.
 */

namespace daw::util {

/** Install terminate/abort/invalid-parameter/SEH hooks. Call once,
 *  first thing in main(). */
void installCrashHandler();

}  // namespace daw::util
