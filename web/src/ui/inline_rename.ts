// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Renommage INLINE (clic droit "Renommer", 2026-08-26) : remplace le texte
 * d'un element par un <input> en place. Entree ou blur = commit (trim, si
 * change) ; Echap = annule. Pendant l'edition, le data-role de l'hote est
 * suspendu (le bandeau de clip est une poignee de drag - un input qui herite
 * du role declencherait un drag au premier clic dedans).
 */

export function startInlineRename(
  host: HTMLElement,
  current: string,
  commit: (name: string) => void,
): void {
  if (host.querySelector('input')) return;  // deja en edition
  const prevText = host.textContent ?? '';
  const prevRole = host.dataset.role;
  delete host.dataset.role;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-rename';
  input.value = current;
  input.maxLength = 64;
  input.setAttribute('aria-label', 'Renommer');
  // Ne jamais laisser les gestes de la lane (drag/selection) voir ces clics
  for (const ev of ['pointerdown', 'pointerup', 'click', 'dblclick'] as const) {
    input.addEventListener(ev, (e) => e.stopPropagation());
  }

  let done = false;
  const finish = (apply: boolean): void => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    input.remove();
    if (prevRole !== undefined) host.dataset.role = prevRole;
    if (apply && value !== current.trim()) {
      commit(value);
    } else {
      host.textContent = prevText;  // le commit re-rend ; l'annulation restaure
    }
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();  // Space/Delete/Ctrl+Z sont des raccourcis globaux
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));

  host.textContent = '';
  host.appendChild(input);
  input.focus();
  input.select();
}
