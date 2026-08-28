// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Selection MULTIPLE de clips (2026-08-28, demande utilisateur « comme
 * dans Ableton ») : `ctx.selectedClipId` reste le clip PRINCIPAL (le
 * dernier clique - les gestes a un clip : Ctrl+E, menus) ; l'ensemble
 * `ctx.selectedClipIds` porte le lot (deplacement, Suppr, Ctrl+D, lasso).
 * L'invariant : le principal est toujours dans le lot, ou les deux vides.
 */

import { ctx } from './context';
import type { ClipDef } from '../document/schema';

/** Selectionne un clip ; `additive` (Shift/Ctrl) l'ajoute ou le retire. */
export function selectClip(clipId: string, trackId: string, additive = false): void {
  if (additive) {
    if (ctx.selectedClipIds.has(clipId) && ctx.selectedClipIds.size > 1) {
      ctx.selectedClipIds.delete(clipId);
      if (ctx.selectedClipId === clipId) {
        ctx.selectedClipId = [...ctx.selectedClipIds][ctx.selectedClipIds.size - 1] ?? null;
      }
      ctx.selectedTrackId = trackId;
      return;
    }
    ctx.selectedClipIds.add(clipId);
  } else {
    ctx.selectedClipIds.clear();
    ctx.selectedClipIds.add(clipId);
  }
  ctx.selectedClipId = clipId;
  ctx.selectedTrackId = trackId;
}

export function clearClipSelection(): void {
  ctx.selectedClipIds.clear();
  ctx.selectedClipId = null;
}

/** Remplace le lot (lasso) ; le principal = le dernier de la liste. */
export function setClipSelection(ids: string[], additive = false): void {
  if (!additive) ctx.selectedClipIds.clear();
  for (const id of ids) ctx.selectedClipIds.add(id);
  if (ids.length) ctx.selectedClipId = ids[ids.length - 1];
  else if (!additive || !ctx.selectedClipIds.size) ctx.selectedClipId = null;
}

export function isClipSelected(clipId: string): boolean {
  return ctx.selectedClipIds.has(clipId);
}

/** Le lot, resolu dans le document (les ids disparus tombent). */
export function selectedClips(): { trackId: string; clip: ClipDef }[] {
  const doc = ctx.project?.getDocument();
  if (!doc) return [];
  const out: { trackId: string; clip: ClipDef }[] = [];
  for (const t of doc.tracks) for (const c of t.clips) {
    if (ctx.selectedClipIds.has(c.id)) out.push({ trackId: t.id, clip: c });
  }
  const alive = new Set(out.map((x) => x.clip.id));
  for (const id of [...ctx.selectedClipIds]) if (!alive.has(id)) ctx.selectedClipIds.delete(id);
  if (ctx.selectedClipId && !alive.has(ctx.selectedClipId)) {
    ctx.selectedClipId = out[out.length - 1]?.clip.id ?? null;
  }
  return out;
}
