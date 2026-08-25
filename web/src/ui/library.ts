// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Sample library — the base kit strip (2026-08-22).
 *
 * Interaction model (smallest thing that works): click a chip to ARM a
 * sample (highlighted), then click a track lane to PLACE a clip there
 * (snapped). Clicking the armed chip again disarms; with nothing armed,
 * a lane click just selects the track.
 *
 * Contract: [data-role="sample"][data-sample-name], aria-pressed = armed.
 */

export interface KitSample {
  name: string;
  hash: string;
  seconds: number;
}

export interface Kit {
  sampleRate: number;
  samples: KitSample[];
}

export async function loadKit(): Promise<Kit | null> {
  try {
    const res = await fetch('/kit.json');
    if (!res.ok) return null;
    return await res.json() as Kit;
  } catch {
    return null;
  }
}

export class Library {
  private armed: KitSample | null = null;
  readonly element: HTMLElement;
  readonly count: number;

  constructor(kit: Kit) {
    this.count = kit.samples.length;
    this.element = document.createElement('div');
    this.element.className = 'library';
    const label = document.createElement('span');
    label.className = 'library-label';
    label.textContent = 'Kit';
    this.element.appendChild(label);
    for (const sample of kit.samples) {
      const chip = document.createElement('button');
      chip.className = 'sample-chip';
      chip.dataset.role = 'sample';
      chip.dataset.sampleName = sample.name;
      chip.textContent = sample.name;
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', () => {
        const arming = this.armed?.name !== sample.name;
        this.armed = arming ? sample : null;
        for (const c of this.element.querySelectorAll('.sample-chip')) {
          c.setAttribute('aria-pressed',
            arming && c === chip ? 'true' : 'false');
        }
        document.body.classList.toggle('sample-armed', arming);
        // Release focus: the keyboard handler bails on a focused BUTTON,
        // so a still-focused chip swallowed Space/zoom (found by the
        // background composer). Arm the sample, give the keys back.
        chip.blur();
      });
      this.element.appendChild(chip);
    }
    const hint = document.createElement('span');
    hint.className = 'library-hint';
    hint.textContent = 'arm a sample, click a lane to place it';
    this.element.appendChild(hint);
  }

  getArmed(): KitSample | null {
    return this.armed;
  }
}
