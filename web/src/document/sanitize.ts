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

/** v2 : borne des ticks — miroir de MAX_TICK du noyau tempo (2^36,
 *  garde d'overflow int64 partagee avec le C++). */
const MAX_TICK = 2 ** 36;

/** v2 : coerce un champ tick du document (NaN/Infinity/negatif/enorme
 *  deviennent surs) — le jumeau musical de clampSamples. */
export function clampTick(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.max(0, Math.min(MAX_TICK, v));
}

/**
 * v2 : EXCLUSIVITE DE DOMAINE. Un objet du document vit dans UN
 * domaine : absolu (samples) OU musical (ticks) — jamais les deux pour
 * la POSITION. Un clip musical (startTick present) qui porte aussi un
 * startSample est corrompu ou hostile : la verite est ambigue entre
 * pairs. Retourne un message de violation, ou null si sain.
 * (Un clip AUDIO musical garde legitimement lengthSamples : le contenu
 * ne s'etire pas — seule la POSITION est exclusive.)
 */
export function clipDomainViolation(
  clip: { startSample?: unknown; startTick?: unknown }): string | null {
  if (typeof clip.startTick === 'number' &&
      typeof clip.startSample === 'number') {
    return 'clip musical (startTick) portant aussi startSample : ' +
      'position ambigue, domaine exclusif viole';
  }
  return null;
}

/** Escape a document id for safe use inside a CSS selector string.
 *  Falls back to a bracket-safe strip if CSS.escape is unavailable. */
export function cssId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return String(id).replace(/["\\\]]/g, '');
}
