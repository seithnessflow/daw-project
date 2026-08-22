// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Defensive coercion of DOCUMENT-DERIVED values (audit M5). In a
 * collaborative future the document is attacker-controllable: a hostile
 * peer's huge lengthSamples turns into a giant DOM node (freeze/OOM), and
 * an id containing a quote breaks an interpolated CSS selector. These
 * helpers make the web the LAST place a hostile document can crash.
 */

/** Max clip span we will ever lay out: 24 h at 48 kHz. Beyond this the
 *  value is hostile or corrupt, not music - clamp, never trust. */
const MAX_SAMPLES = 48000 * 60 * 60 * 24;

/** Coerce a document sample field to a finite, non-negative, bounded
 *  number of samples (NaN/Infinity/negative/huge all become safe). */
export function clampSamples(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(MAX_SAMPLES, v));
}

/** Escape a document id for safe use inside a CSS selector string.
 *  Falls back to a bracket-safe strip if CSS.escape is unavailable. */
export function cssId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return String(id).replace(/["\\\]]/g, '');
}
