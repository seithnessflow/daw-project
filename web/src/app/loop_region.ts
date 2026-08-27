// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Boucle UTILISATEUR (AUDIT-6 QW, 2026-08-27) : la bande superieure de la
 * regle (.ruler-cycle, reservee depuis la refonte) prend vie.
 *
 * Gestes (deleguees au document : la regle est reconstruite a chaque
 * renderTracks, les listeners directs mourraient) :
 * - DRAG sur la bande = poser la region [debut, fin) snappee a la grille
 *   (Alt = sans snap) ET activer la boucle (poser = vouloir boucler).
 * - DOUBLE-CLIC sur la bande = effacer la region (retour aux braces auto,
 *   boucle coupee). Le bouton loop garde son role : toggle ON/OFF sans
 *   toucher la region.
 * - Escape pendant le drag = annuler.
 *
 * L'etat est de la PERFORMANCE par onglet (ctx.loopRegion, jamais le
 * document) ; l'etrier se REND dans createRulerUI (il suit zoom et
 * rebuilds). A la reconnexion moteur, reassertLoopRegion() repousse la
 * region (un moteur relance perd ses atomics).
 */

import { ctx, els } from './context';
import { TIMELINE } from '../ui/track';
import { snapStep } from './navigation';
import { renderTracks } from './render';

const MIN_DRAG_PX = 4;   // en dessous : un clic, pas une pose

function sampleRate(): number {
  return ctx.project?.getDocument().sampleRate || 48000;
}

/** Repousse la region au moteur (reconnexion) ; true si une region existe. */
export function reassertLoopRegion(): boolean {
  if (!ctx.loopRegion || !ctx.engineClient) return false;
  const sr = sampleRate();
  ctx.engineClient.setLoopRegion(
    Math.round(ctx.loopRegion.startSec * sr),
    Math.round(ctx.loopRegion.endSec * sr));
  return true;
}

export function wireLoopRegion(): void {
  let drag: {
    band: HTMLElement; originSec: number; brace: HTMLElement;
    startSec: number; endSec: number;
  } | null = null;

  const secAt = (band: HTMLElement, clientX: number): number =>
    Math.max(0, (clientX - band.getBoundingClientRect().left) / TIMELINE.pps);

  const snap = (sec: number, noSnap: boolean): number => {
    if (noSnap) return sec;
    const step = snapStep();
    return Math.round(sec / step) * step;
  };

  // Candidat au drag : pose au pointerdown, ne DEVIENT un drag qu'au
  // seuil de mouvement. Pas de preventDefault au down (il supprimerait
  // les evenements souris derives - dont le DBLCLICK d'effacement) ; un
  // simple clic ne touche a rien (regle du clic-sans-mouvement).
  let candidate: { band: HTMLElement; originSec: number; x: number } | null =
    null;

  document.addEventListener('pointerdown', (e) => {
    const band = (e.target as HTMLElement).closest('.ruler-cycle');
    if (!band || e.button !== 0) return;
    candidate = { band: band as HTMLElement,
      originSec: secAt(band as HTMLElement, e.clientX), x: e.clientX };
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag && candidate &&
        Math.abs(e.clientX - candidate.x) >= MIN_DRAG_PX) {
      const brace = document.createElement('div');
      brace.className = 'cycle-brace dragging';
      candidate.band.querySelector('.cycle-brace:not(.dragging)')?.remove();
      candidate.band.appendChild(brace);
      drag = { band: candidate.band, originSec: candidate.originSec, brace,
        startSec: candidate.originSec, endSec: candidate.originSec };
      candidate = null;
    }
    if (!drag) return;
    const cur = secAt(drag.band, e.clientX);
    drag.startSec = snap(Math.min(drag.originSec, cur), e.altKey);
    drag.endSec = snap(Math.max(drag.originSec, cur), e.altKey);
    drag.brace.style.left = `${drag.startSec * TIMELINE.pps}px`;
    drag.brace.style.width =
      `${Math.max(0, (drag.endSec - drag.startSec) * TIMELINE.pps)}px`;
  });

  const cancel = (): void => {
    if (!drag) return;
    drag.brace.remove();
    drag = null;
    renderTracks(true);  // re-rendre l'etrier commis (s'il existe)
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drag) cancel();
  });

  document.addEventListener('pointerup', () => {
    candidate = null;  // clic sans mouvement : aucun effet
    if (!drag) return;
    const { startSec, endSec, brace } = drag;
    const widthPx = (endSec - startSec) * TIMELINE.pps;
    drag = null;
    if (widthPx < MIN_DRAG_PX) {
      // Drag reduit a rien (aller-retour) : on annule proprement
      brace.remove();
      renderTracks(true);  // re-rendre l'ancien etrier s'il existait
      return;
    }
    ctx.loopRegion = { startSec, endSec };
    brace.classList.remove('dragging');
    const sr = sampleRate();
    ctx.engineClient?.setLoopRegion(
      Math.round(startSec * sr), Math.round(endSec * sr));
    // Poser une region ACTIVE la boucle : le bouton l'annonce
    els.loopBtn.setAttribute('aria-pressed', 'true');
  });

  document.addEventListener('dblclick', (e) => {
    const band = (e.target as HTMLElement).closest('.ruler-cycle');
    if (!band) return;
    if (!ctx.loopRegion) return;
    ctx.loopRegion = null;
    ctx.engineClient?.clearLoopRegion();
    els.loopBtn.setAttribute('aria-pressed', 'false');
    renderTracks(true);
  });
}
