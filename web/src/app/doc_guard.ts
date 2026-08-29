// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * GARDE DE DOCUMENT (A4-8, decision utilisateur 2026-08-29 : « on charge
 * avec un bandeau »). Chaque document recu du serveur (premier contact,
 * fusion, change) passe par validateDocument ; s'il est invalide, il se
 * charge QUAND MEME et le bandeau `#doc-banner` le dit, avec les fautes
 * (les trois premieres en clair, toutes dans le title). Il s'eteint seul
 * quand le document redevient sain. Regle gravee : un etat qui ment par
 * omission n'existe pas - ni refus silencieux, ni chargement muet.
 *
 * Sonde de pilotage : window.__dawDocValidity = { errors, checkedAt }.
 */
import { ctx } from './context';
import { validateDocument } from '../document/validate';

let banner: HTMLElement | null = null;
let shownFor = '';  // ne reconstruire le bandeau qu'au changement de rapport

export function checkDocument(): string[] {
  if (!ctx.project) return [];
  const errors = validateDocument(ctx.project.getDocument());
  (window as any).__dawDocValidity = { errors, checkedAt: Date.now() };
  banner ??= document.getElementById('doc-banner');
  if (!banner) return errors;
  const key = errors.join('|');
  if (key === shownFor) return errors;
  shownFor = key;
  if (errors.length === 0) {
    banner.hidden = true;
    banner.replaceChildren();
    return errors;
  }
  banner.replaceChildren();
  const txt = document.createElement('span');
  const shown = errors.slice(0, 3).join(' ; ');
  txt.textContent = `Document invalide (${errors.length} faute${errors.length > 1 ? 's' : ''}) — `
    + `charge quand meme : ${shown}${errors.length > 3 ? ' ; …' : ''}`;
  banner.append(txt);
  banner.title = errors.join('\n');
  banner.hidden = false;
  return errors;
}

/** Branche la garde : un premier passage, puis wiring appelle
 *  checkDocument() a chaque document recu. */
export function wireDocGuard(): void {
  checkDocument();
}
