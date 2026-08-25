// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Commutateur de paradigmes (Refonte T6) : Arrangement / Session / Mixage.
 * Presentation LOCALE par onglet (cf. principe "presentation = locale, donnees
 * = partagees") -> body[data-paradigm] + localStorage, jamais dans le doc.
 * Le CSS bascule les vues (layout/session). Mixage arrive en T8 (fallback :
 * arrangement tant qu'aucune vue mixage n'existe).
 */

import { renderSession } from '../ui/session';
import { renderMixer } from '../ui/mixer';

const KEY = 'daw-paradigm';

function apply(view: string): void {
  document.body.dataset.paradigm = view;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-role="paradigm"]')) {
    btn.setAttribute('aria-pressed', btn.dataset.view === view ? 'true' : 'false');
  }
  try { localStorage.setItem(KEY, view); } catch { /* private mode: ignore */ }
  if (view === 'session') renderSession();
  if (view === 'mixage') renderMixer();
}

export function initParadigm(): void {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
  apply(saved || 'arrangement');
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-role="paradigm"]')) {
    btn.addEventListener('click', () => apply(btn.dataset.view || 'arrangement'));
  }
}
