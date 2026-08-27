// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * T3 : le champ TEMPO de la topbar. Le document parle en milli-BPM
 * entier (invariant : jamais un float dans le document) ; l'input
 * parle en BPM decimal (120, 97.5). Ecrire = setTempoMilliBpm
 * (clampe, undoable, ensureV2 lazy) ; un changement de tempo re-rend
 * la timeline (la geometrie MUSICALE bouge, l'absolue jamais).
 */

import { ctx, sendLastChange } from './context';
import { renderTracks } from './render';

function input(): HTMLInputElement | null {
  return document.getElementById('tempo-input') as HTMLInputElement | null;
}

/** Affiche le registre du document (jamais pendant la saisie). */
export function refreshTempoField(): void {
  const el = input();
  if (!el || document.activeElement === el) return;
  const mb = ctx.project?.getDocument().tempoMilliBpm ?? 120000;
  // milli-BPM -> BPM, sans zeros de queue (120, pas 120.000)
  el.value = String(Math.round(mb / 100) / 10);
}

export function wireTempoField(): void {
  const el = input();
  if (!el) return;
  el.addEventListener('change', () => {
    if (!ctx.project) return;
    const bpm = Number(el.value);
    if (!Number.isFinite(bpm)) {
      refreshTempoField();
      return;
    }
    ctx.project.setTempoMilliBpm(Math.round(bpm * 1000));
    sendLastChange();
    el.blur();
    refreshTempoField();
    renderTracks(true);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.blur();
    if (e.key === 'Escape') {
      refreshTempoField();
      el.blur();
    }
  });
  refreshTempoField();
}
