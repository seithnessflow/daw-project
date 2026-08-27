// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * V1.4 - The shortcuts panel ("?"). Session C's finding: the DAW knew
 * 16 things nobody could discover. This panel SAYS them. Toggled by the
 * "?" key or the topbar button; Escape closes.
 */

const SHORTCUTS: Array<[string, string]> = [
  ['Espace', 'Lecture / arret (depuis le marqueur)'],
  ['Ctrl+Z / Ctrl+Y', 'Annuler / retablir (par geste, collaboratif)'],
  ['Suppr', 'Supprimer le clip selectionne'],
  ['Ctrl+D', 'Dupliquer le clip selectionne sur le pas suivant'],
  ['Ctrl+E', 'Scinder le clip selectionne au marqueur'],
  ['Glisser la bande fine de la regle', 'Poser la boucle (double-clic : effacer)'],
  ['+ / -', 'Zoom avant / arriere (centre)'],
  ['Ctrl+molette', 'Zoom autour du curseur'],
  ['W', 'Tout le morceau a l’ecran'],
  ['Z / X', 'Zoom sur le marqueur / revenir (pile)'],
  ['H', 'Pistes compactes'],
  ['Alt + glisser', 'Desactiver le snap pendant le geste'],
  ['Double-clic (vue d’ensemble)', 'Tout cadrer'],
  ['Clic sur un couloir', 'Selectionne la piste + pose le marqueur + pause le follow'],
  ['?', 'Cette aide'],
];

let overlay: HTMLElement | null = null;

function build(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'help-overlay';
  el.className = 'help-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Raccourcis clavier');

  const panel = document.createElement('div');
  panel.className = 'help-panel';

  const title = document.createElement('h2');
  title.textContent = 'Raccourcis';
  panel.appendChild(title);

  const table = document.createElement('table');
  for (const [keys, what] of SHORTCUTS) {
    const tr = document.createElement('tr');
    const kd = document.createElement('td');
    const kbd = document.createElement('kbd');
    kbd.textContent = keys;
    kd.appendChild(kbd);
    const wd = document.createElement('td');
    wd.textContent = what;
    tr.appendChild(kd);
    tr.appendChild(wd);
    table.appendChild(tr);
  }
  panel.appendChild(table);

  const hint = document.createElement('p');
  hint.className = 'help-hint';
  hint.textContent = 'Echap ou clic pour fermer';
  panel.appendChild(hint);

  el.appendChild(panel);
  el.addEventListener('click', () => toggleHelp(false));
  document.body.appendChild(el);
  return el;
}

export function toggleHelp(show?: boolean): void {
  overlay ??= build();
  const visible = overlay.classList.contains('open');
  const next = show ?? !visible;
  overlay.classList.toggle('open', next);
}

export function isHelpOpen(): boolean {
  return overlay?.classList.contains('open') ?? false;
}
