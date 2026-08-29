// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * LE FUSIBLE, vu du site (2026-08-29). Le moteur porte un limiteur
 * brick-wall sur sa sortie LIVE (jamais dans les stems ni l'export) ;
 * ce module montre ce qu'il retient. Regle gravee : une action qui
 * modifie le son se MONTRE, jamais en silence - quand le fusible
 * travaille, le badge LIM s'allume avec la reduction en dB.
 *
 * Lecture seule, mutation DOM directe (30 Hz), aucune ecriture document.
 * Ballistique : allume tant que le moteur reduit, puis tenue ~700 ms
 * (un pic d'un bloc = 5 ms serait invisible a l'oeil sinon).
 */

export interface LimiterState {
  limiterReductionDb: number;
  limiterEngagedBlocks: number;
  limiterCeilingDb: number;
  limiterEnabled: boolean;
}

const HOLD_MS = 700;

let badge: HTMLElement | null = null;
let heldUntil = 0;
let heldDb = 0;
let lastEngaged = -1;

function ensureBadge(): HTMLElement | null {
  if (badge && badge.isConnected) return badge;
  badge = document.getElementById('limiter-badge');
  return badge;
}

/** Telemetrie EngineState (appelee par la couche reseau, ~30 Hz). */
export function setLimiterState(s: LimiterState): void {
  const el = ensureBadge();
  const now = performance.now();
  // Un bloc retenu depuis la derniere trame = le fusible a travaille,
  // meme si la reduction du dernier bloc est deja retombee a 0.
  const worked = lastEngaged >= 0 && s.limiterEngagedBlocks > lastEngaged;
  lastEngaged = s.limiterEngagedBlocks;
  if (s.limiterReductionDb > 0 || worked) {
    heldUntil = now + HOLD_MS;
    // La valeur tenue = la plus forte reduction de la tenue en cours (le
    // moteur envoie deja la crete entre deux trames) - jamais « -0.0 »
    heldDb = Math.max(heldDb, s.limiterReductionDb, 0.1);
  }
  const active = s.limiterEnabled && now < heldUntil;
  if (!active) heldDb = 0;

  const state = !s.limiterEnabled ? 'off' : active ? 'active' : 'idle';
  (window as any).__dawLimiter = {
    reductionDb: s.limiterReductionDb,
    engagedBlocks: s.limiterEngagedBlocks,
    ceilingDb: s.limiterCeilingDb,
    enabled: s.limiterEnabled,
    state,
  };
  if (!el) return;
  if (el.dataset.state !== state) el.dataset.state = state;
  const text = state === 'active' ? `LIM -${heldDb.toFixed(1)}` : 'LIM';
  if (el.textContent !== text) el.textContent = text;
  const title = s.limiterEnabled
    ? `Fusible de sortie : brick-wall a ${s.limiterCeilingDb.toFixed(1)} dBFS `
      + `(sortie live seulement, jamais dans l'export). `
      + `Blocs retenus : ${s.limiterEngagedBlocks}`
    : 'Fusible de sortie DESACTIVE (--no-limiter) : rien ne protege les moniteurs';
  if (el.title !== title) el.title = title;
}
