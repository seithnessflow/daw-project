// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * IDENTIFIANTS DU DOCUMENT (A4-11, 2026-08-29). SCHEMA.md exige un UUID ;
 * le code fabriquait des `track-${Date.now()}` (deux onglets qui creent
 * une piste dans la meme milliseconde = COLLISION dans un document
 * partage, silencieuse) et des `Math.random().toString(36).slice(2, 8)`
 * (36^6 = 2 milliards : petit pour un CRDT qui vit des mois).
 *
 * Un seul fabricant : `newId(prefix)` = `<prefix>-<uuid v4>`. Le prefixe
 * reste lisible dans les selecteurs et les logs (`clip-`, `track-`,
 * `dev-`, `scene-`, `n-`, `lane-`) ; l'unicite vient de l'UUID.
 * `crypto.randomUUID` existe dans tout contexte securise (localhost et
 * https) ; le repli n'est la que pour un contexte non securise exotique.
 */

export function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Repli RFC 4122 v4 sur getRandomValues (jamais Math.random seul)
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** `<prefix>-<uuid>` ; un `stem` optionnel garde l'id lisible : `clip-kick-<uuid>`. */
export function newId(prefix: string, stem?: string): string {
  return stem ? `${prefix}-${stem}-${uuid()}` : `${prefix}-${uuid()}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Le stem lisible d'un id de clip (`clip-kick-<uuid>` -> `kick`), les
 *  formes historiques comprises (`clip-kick-1788012345678`, `-k`). */
export function clipStem(id: string): string {
  const parts = id.replace(/^clip-/, '').split('-');
  // Retire les segments de queue qui sont un uuid (5 segments) ou des nombres
  while (parts.length > 1) {
    const tail5 = parts.slice(-5).join('-');
    if (parts.length >= 5 && UUID_RE.test(tail5)) { parts.splice(-5, 5); continue; }
    if (/^\d+$/.test(parts[parts.length - 1])) { parts.pop(); continue; }
    break;
  }
  return parts.join('-') || 'clip';
}
