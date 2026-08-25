// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Menu contextuel generique (clic droit, 2026-08-26). Un seul menu a la fois,
 * flottant, repositionne s'il deborde ; se ferme au clic exterieur, Echap,
 * scroll ou resize. Le CONTENU (les actions) est decide par zone dans
 * app/context_menu_dispatch.ts - ce module ne fait que rendre/placer/fermer.
 */

export interface MenuItem {
  label?: string;
  onClick?: () => void;
  danger?: boolean;     // action destructive (rouge)
  disabled?: boolean;
  separator?: boolean;  // ligne de separation (les autres champs ignores)
}

let current: HTMLElement | null = null;
let onClose: (() => void) | null = null;

export function closeContextMenu(): void {
  if (!current) return;
  current.remove();
  current = null;
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', closeContextMenu);
  window.removeEventListener('blur', closeContextMenu);
  document.removeEventListener('scroll', closeContextMenu, true);
  onClose?.();
  onClose = null;
}

function outside(e: Event): void {
  if (current && !current.contains(e.target as Node)) closeContextMenu();
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') { e.preventDefault(); closeContextMenu(); }
}

export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'ctx-item' + (item.danger ? ' danger' : '');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = item.label ?? '';
    if (item.disabled) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => {
        closeContextMenu();
        item.onClick?.();
      });
    }
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);

  // Placement : ancre en (x, y), repli si ca deborde a droite/en bas.
  const r = menu.getBoundingClientRect();
  const px = x + r.width > window.innerWidth ? Math.max(4, x - r.width) : x;
  const py = y + r.height > window.innerHeight ? Math.max(4, y - r.height) : y;
  menu.style.left = `${px}px`;
  menu.style.top = `${py}px`;

  current = menu;
  // differe l'ecoute du clic exterieur au tick suivant (ne pas se fermer sur
  // le pointerup du clic droit qui vient de l'ouvrir)
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('blur', closeContextMenu);
    document.addEventListener('scroll', closeContextMenu, true);
  }, 0);
  // focus le 1er item actionnable (clavier)
  menu.querySelector<HTMLButtonElement>('.ctx-item:not(:disabled)')?.focus();
}
