// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * F7 : onglets de la colonne droite (Rack / Piano-roll). Presentation LOCALE
 * par onglet (data-rack-tab sur .col-rack + localStorage, jamais le doc). Le
 * rendu (render.ts) produit les DEUX panneaux ; le CSS montre l'actif.
 */

const KEY = 'daw-rack-tab';

function apply(tab: string): void {
  const col = document.querySelector<HTMLElement>('.col-rack');
  if (col) col.dataset.rackTab = tab;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-role="rack-tab"]')) {
    btn.setAttribute('aria-selected', btn.dataset.tab === tab ? 'true' : 'false');
  }
  try { localStorage.setItem(KEY, tab); } catch { /* private mode: ignore */ }
}

export function initRackTabs(): void {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
  apply(saved === 'piano' ? 'piano' : 'rack');
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-role="rack-tab"]')) {
    btn.addEventListener('click', () => apply(btn.dataset.tab || 'rack'));
  }
}
