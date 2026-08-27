// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pre-ecoute des samples (AUDIT-6 quick win) : le geste browser-first de
 * Live - ENTENDRE un sample avant de le poser. Un petit ▶ par chip ;
 * clic = jouer (fetch du store + decode, cache par hash), re-clic ou
 * autre preview = stop. UN SEUL preview a la fois.
 *
 * Securite auditive : la pre-ecoute est TOUJOURS un geste utilisateur
 * (jamais auto), passe par un GainNode a -3 dB (les samples bruts ne
 * passent ni master ni fader - on ne les envoie pas pleine echelle), et
 * s'arrete d'elle-meme a la fin du fichier.
 */

import { SERVER_HTTP, assetAuthHeaders } from '../app/context';

const PREVIEW_GAIN = 0.7;  // ~-3 dB : jamais un one-shot pleine echelle

let ac: AudioContext | null = null;
let gain: GainNode | null = null;
const cache = new Map<string, AudioBuffer>();
let current: { src: AudioBufferSourceNode; el: HTMLElement } | null = null;

function ensureContext(): AudioContext {
  if (!ac) {
    ac = new AudioContext();
    gain = ac.createGain();
    gain.gain.value = PREVIEW_GAIN;
    gain.connect(ac.destination);
  }
  return ac;
}

/** Arrete le preview en cours (s'il y en a un) et eteint son etat UI. */
export function stopPreview(): void {
  if (!current) return;
  try { current.src.stop(); } catch { /* deja fini */ }
  current.el.classList.remove('playing');
  current.el.textContent = '▶';
  current = null;
}

/**
 * Joue / arrete le sample <hash>. `el` est le declencheur visuel (le ▶
 * du chip) : .playing + ■ pendant la lecture, retour ▶ a la fin.
 */
export async function togglePreview(hash: string, el: HTMLElement):
  Promise<void> {
  if (current?.el === el) { stopPreview(); return; }
  stopPreview();

  const ctx2 = ensureContext();
  if (ctx2.state === 'suspended') await ctx2.resume();  // politique autoplay

  let buffer = cache.get(hash);
  if (!buffer) {
    try {
      const res = await fetch(`${SERVER_HTTP}/assets/${hash}`, {
        headers: assetAuthHeaders(),
      });
      if (!res.ok) throw new Error(`store HTTP ${res.status}`);
      buffer = await ctx2.decodeAudioData(await res.arrayBuffer());
      cache.set(hash, buffer);
    } catch (e) {
      // Refus visible, pas un silence : le ▶ flashe et dit pourquoi.
      el.classList.remove('refused');
      void (el as HTMLElement).offsetWidth;
      el.classList.add('refused');
      el.title = `Pre-ecoute impossible : ${String(e)}`;
      console.error('preview failed:', hash, e);
      return;
    }
  }

  const src = ctx2.createBufferSource();
  src.buffer = buffer;
  src.connect(gain!);
  src.onended = () => {
    if (current?.src === src) {
      current.el.classList.remove('playing');
      current.el.textContent = '▶';
      current = null;
    }
  };
  current = { src, el };
  el.classList.add('playing');
  el.textContent = '■';
  src.start();
}
