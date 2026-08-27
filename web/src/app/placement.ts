// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Material intake (Magic Potion phase 1): dropped WAV files become
 * project assets + clips through the verifying store; the palette
 * rebuilds itself from the PROJECT's own assets (no embedded demo kit
 * outside ?lab=1).
 */

import { TIMELINE } from '../ui/track';
import { clipDisplayName, orderedTracks, makeTrackDef,
         trackAcceptsAudio, trackAcceptsMidi } from '../document/schema';
import { Library, loadKit, type Kit, type KitSample } from '../ui/library';
import { decodeDurationSec } from '../ui/waveform';
import { SERVER_HTTP, assetAuthHeaders } from './context';
import { ctx, els, sendLastChange, LAB_MODE } from './context';
import { renderTracks } from './render';
import { renderBrowser } from '../ui/browser';
import { markLanded } from './gestures';
import { snapStep } from './navigation';

/**
 * A dropped file becomes a project asset + a clip: verify it is a WAV,
 * hash it client-side, PUT through the verifying store, place the clip
 * where it was dropped. Failures are loud, never silent.
 */
/**
 * REFUS VISIBLE d'un geste sur un couloir (garde de kind) : le couloir
 * flashe rouge + la raison en title + console. Jamais un clic/drop qui
 * ne fait rien en silence (regle des effets annonces).
 */
export function flashLaneRefusal(lane: HTMLElement, why: string): void {
  lane.classList.remove('kind-refused');
  void lane.offsetWidth;
  lane.classList.add('kind-refused');
  lane.title = why;
  console.error(`geste refuse: ${why}`);
}

/** Le couloir DOM d'une piste (pour flasher un refus) - null si absent. */
function laneOf(trackId: string): HTMLElement | null {
  return document.querySelector(
    `[data-track-id="${trackId}"] .track-lane`) as HTMLElement | null;
}

/**
 * IMPORT UNIVERSEL (AUDIT-6 QW, 2026-08-27) : re-encode un AudioBuffer en
 * WAV PCM 16 bits. Le STORE reste du WAV canonique (le moteur ne change
 * pas) ; le decodage navigateur (mp3/flac/ogg/m4a) + l'OfflineAudioContext
 * au taux du PROJET donnent le resampling gratuitement. 16 bits assume
 * (documente) : les sources compressees sont deja lossy ; un FLAC 24 bits
 * perd 8 bits a l'import - dette datee si ca gene.
 */
export function encodeWav16(buf: AudioBuffer): ArrayBuffer {
  const ch = Math.min(2, buf.numberOfChannels);
  const frames = buf.length;
  const out = new ArrayBuffer(44 + frames * ch * 2);
  const v = new DataView(out);
  const w4 = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w4(0, 'RIFF'); v.setUint32(4, 36 + frames * ch * 2, true); w4(8, 'WAVE');
  w4(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);                       // PCM
  v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true); // byte rate
  v.setUint16(32, ch * 2, true);                  // block align
  v.setUint16(34, 16, true);                      // bits
  w4(36, 'data'); v.setUint32(40, frames * ch * 2, true);
  const chans = [] as Float32Array[];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  }
  return out;
}

/** Decode n'importe quel format navigateur AU TAUX DONNE -> WAV 16 bits. */
export async function transcodeToProjectWav(
  input: ArrayBuffer, sampleRate: number): Promise<ArrayBuffer> {
  // OfflineAudioContext : decodeAudioData RESAMPLE vers le taux du
  // contexte (spec WebAudio) - le 44.1k arrive a 48k sans rien faire.
  const oc = new OfflineAudioContext(2, 2, sampleRate);
  const buf = await oc.decodeAudioData(input);
  return encodeWav16(buf);
}

export async function handleFileDrop(
  file: File, trackId: string, laneX: number): Promise<void> {
  if (!ctx.project) return;
  // Garde de kind : un fichier audio ne se pose pas sur une piste MIDI
  const tdef = ctx.project.getDocument().tracks.find((t) => t.id === trackId);
  if (tdef && !trackAcceptsAudio(tdef)) {
    const lane = laneOf(trackId);
    if (lane) flashLaneRefusal(lane,
      'Piste MIDI : un fichier audio ne se pose pas ici');
    return;
  }
  let bytes = await file.arrayBuffer();
  const head = new Uint8Array(bytes.slice(0, 12));
  const ascii = (o: number, n: number) =>
    String.fromCharCode(...head.slice(o, o + n));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') {
    // Pas un WAV : IMPORT UNIVERSEL - le navigateur decode (mp3/flac/
    // ogg/m4a), on re-encode en WAV canonique au taux du projet. Un
    // fichier indechiffrable = refus VISIBLE, jamais un silence.
    try {
      const rate = ctx.project.getDocument().sampleRate || 48000;
      bytes = await transcodeToProjectWav(bytes, rate);
      console.log(`import: ${file.name} transcode en WAV ${rate} Hz `
        + `(${bytes.byteLength} octets)`);
    } catch {
      const lane = laneOf(trackId);
      if (lane) flashLaneRefusal(lane,
        `« ${file.name} » n'est pas un fichier audio lisible`);
      console.error(`drop refused: ${file.name} undecodable`);
      return;
    }
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const res = await fetch(`${SERVER_HTTP}/assets/${hash}`, {
    method: 'PUT', body: bytes, headers: assetAuthHeaders(),
  });
  if (res.status !== 201) {
    console.error(`asset store refused ${file.name}: ${res.status} ${await res.text()}`);
    return;
  }
  let durationSec: number;
  try {
    durationSec = await decodeDurationSec(bytes);
  } catch {
    console.error(`drop refused: ${file.name} did not decode as audio`);
    return;
  }
  const sr = ctx.project.getDocument().sampleRate || 48000;
  // Snap de pose = LA grille du zoom (session de composition 2026-08-27 :
  // le 0.25 fixe interdisait les contretemps fins que la grille dessinait)
  const step = snapStep();
  const sec = Math.max(0, Math.round((laneX / TIMELINE.pps) / step) * step);
  const stem = file.name.replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 24) || 'audio';
  const clipId = `clip-${stem}-${Date.now()}`;
  ctx.project.addClip(trackId, {
    id: clipId,
    name: stem,
    assetHash: hash,
    startSample: Math.round(sec * sr),
    lengthSamples: Math.max(1024, Math.round(durationSec * sr)),
    offsetSamples: 0,
  });
  sendLastChange();
  renderTracks();
  markLanded(clipId);
  console.log(`dropped ${file.name}: asset ${hash.slice(0, 12)}..., clip at ${sec}s`);
}

// ---- D3 : drag & drop navigateur -> pistes (DND-DESIGN.md) ----------------
// Uniquement des AJOUTS au document (addTrack/addClip/addProcessor) : zero
// probleme d'identite CRDT. Le payload voyage en JSON sous un MIME custom -
// les drops de FICHIERS (wiring.ts) gardent leur chemin, les deux handlers
// coexistent sur #tracks sans se marcher dessus (le notre ignore les drags
// sans DND_MIME, celui de wiring ignore les drops sans dataTransfer.files).

/** Payload JSON du drag navigateur (instrument/effet: uid; sample: name). */
export const DND_MIME = 'application/x-daw-dnd';
/** Marqueur de TYPE pour les samples : pendant dragover la DATA n'est pas
 *  lisible (spec HTML5), seuls les types le sont - on encode donc "ceci est
 *  un sample" dans un type dedie pour refuser la zone vide (un sample sans
 *  piste cible n'a pas de position, pas de geste "nouvelle piste" en D3). */
export const DND_SAMPLE_MIME = 'application/x-daw-sample';

export type BrowserDragPayload =
  { kind: 'instrument' | 'effect'; uid: string; name: string } |
  { kind: 'sample'; name: string };

// Resolution nom -> {hash, seconds} au moment du DROP : les chips (ui/library,
// intouche - autre chantier) ne portent que le nom. Produit : la map est
// remplie par refreshPalette (la meme source que la palette). Lab : le kit
// vient de /kit.json, charge paresseusement (une fois) au premier drop.
const samplesByName = new Map<string, KitSample>();
let labKitPromise: Promise<Kit | null> | null = null;

async function resolveSample(name: string): Promise<KitSample | null> {
  const known = samplesByName.get(name);
  if (known) return known;
  if (LAB_MODE) {
    labKitPromise ??= loadKit();
    const kit = await labKitPromise;
    for (const s of kit?.samples ?? []) samplesByName.set(s.name, s);
    return samplesByName.get(name) ?? null;
  }
  return null;
}

/**
 * Rend les chips de samples draggables (idempotent - marqueur dndReady).
 * Vit ICI et pas dans ui/library.ts : la Library est un autre chantier ;
 * on decore son DOM par contrat ([data-role="sample"]) sans la modifier.
 */
export function decorateSampleChips(root: HTMLElement): void {
  for (const chip of root.querySelectorAll<HTMLElement>('[data-role="sample"]')) {
    if (chip.dataset.dndReady === '1') continue;
    chip.dataset.dndReady = '1';
    chip.draggable = true;
    chip.addEventListener('dragstart', (e) => {
      const name = chip.dataset.sampleName ?? '';
      e.dataTransfer?.setData(DND_MIME,
        JSON.stringify({ kind: 'sample', name } satisfies BrowserDragPayload));
      e.dataTransfer?.setData(DND_SAMPLE_MIME, name);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    });
  }
}

/** La cible sous le curseur : une piste, ou la zone vide de #tracks (le
 *  ruler et ses enfants ne sont NI l'un NI l'autre - un drop sur la regle
 *  de temps serait un geste ambigu, on le refuse). */
function dropTarget(e: DragEvent): { trackEl: HTMLElement | null; emptyZone: boolean } {
  const target = e.target as HTMLElement;
  const trackEl = target.closest('#tracks [data-track-id]') as HTMLElement | null;
  if (trackEl) return { trackEl, emptyZone: false };
  return { trackEl: null, emptyZone: !target.closest('.ruler-row') };
}

function clearDndFeedback(): void {
  els.tracks.classList.remove('dnd-drop-new');
  for (const el of els.tracks.querySelectorAll('.dnd-drop-track')) {
    el.classList.remove('dnd-drop-track');
  }
}

/**
 * Drop d'un instrument/effet : addProcessor sur la piste cible - ou, zone
 * vide, NOUVELLE piste puis addProcessor (geste Ableton). Le tout dans UN
 * groupe d'undo (regle DND-DESIGN : tout drag = un groupe d'undo). La piste
 * devient la selection courante : le rack montre le nouveau device (regle
 * gravee "une action montre TOUS ses effets").
 */
function addDeviceFromDrop(
  payload: { kind: 'instrument' | 'effect'; uid: string; name: string },
  trackEl: HTMLElement | null,
): void {
  addDeviceToTrack(payload, trackEl?.getAttribute('data-track-id') ?? null);
}

/**
 * Le NOYAU partage des trois entrees (drop sur piste/zone vide, drop sur le
 * RACK, clic droit du navigateur - vague « gestes complets » 2026-08-27) :
 * addProcessor sur la piste (a `index` si fourni - le drop sur le rack vise
 * une POSITION de chaine), ou NOUVELLE piste si trackId null. UN groupe
 * d'undo ; la piste devient la selection (une action montre TOUS ses effets).
 */
export function addDeviceToTrack(
  payload: { kind: 'instrument' | 'effect'; uid: string; name: string },
  trackId: string | null,
  index?: number,
): void {
  if (!ctx.project) return;
  // Garde de kind : un INSTRUMENT ne va pas sur une piste audio (il lui
  // faut des notes) - refus visible sur le couloir de la cible.
  if (trackId && payload.kind === 'instrument') {
    const tdef = ctx.project.getDocument().tracks
      .find((t) => t.id === trackId);
    if (tdef && !trackAcceptsMidi(tdef)) {
      const lane = laneOf(trackId);
      if (lane) flashLaneRefusal(lane,
        'Piste audio : un instrument a besoin d\'une piste MIDI');
      return;
    }
  }
  ctx.project.beginUndoGroup();
  if (!trackId) {
    // Fabrique UNIQUE (l'ancien jumeau wiring/placement est resorbe).
    // Un instrument cree une piste MIDI ; un effet, une piste audio.
    const doc = ctx.project.getDocument();
    const kind = payload.kind === 'instrument' ? 'midi' as const
                                               : 'audio' as const;
    const n = doc.tracks.filter((t) => t.kind === kind).length + 1;
    const def = makeTrackDef(
      kind === 'midi' ? `MIDI ${n}` : `Audio ${n}`, kind);
    trackId = def.id;
    ctx.project.addTrack(def);
  }
  // ProcessorDef au moule du "+ device" vst3 (ui/track.ts) : id, type,
  // uid, name, bypass false, params vides.
  ctx.project.addProcessor(trackId, {
    id: `dev-${Date.now()}`,
    type: 'vst3',
    uid: payload.uid,
    name: payload.name,
    bypass: false,
    params: [],
  }, index);
  ctx.project.endUndoGroup();
  ctx.selectedTrackId = trackId;
  sendLastChange();
  renderTracks(true);
}

/** La piste que le RACK affiche : la selection si elle existe encore,
 *  sinon la premiere en ordre d'affichage (le meme fallback que le rendu). */
function shownRackTrackId(): string | null {
  const d = ctx.project?.getDocument();
  if (!d) return null;
  if (ctx.selectedTrackId && d.tracks.some((t) => t.id === ctx.selectedTrackId)) {
    return ctx.selectedTrackId;
  }
  return orderedTracks(d)[0]?.id ?? null;
}

/** Index d'insertion dans la chaine sous le curseur (milieux horizontaux
 *  des panneaux - jumeau assume de device_reorder.slotAt, meme geometrie). */
function rackInsertIndex(clientX: number): number {
  let slot = 0;
  for (const el of document.querySelectorAll<HTMLElement>(
    '#device-view .device-chain .device[data-proc-id]')) {
    const r = el.getBoundingClientRect();
    if (r.left + r.width / 2 < clientX) slot++;
  }
  return slot;
}

/**
 * Drop d'un sample : pose le clip a la position x du drop (meme pose que
 * le clic arme de wiring.ts - snap = grille du zoom, longueur = duree du sample).
 * Async car la resolution nom->hash peut charger le kit lab ; addClip
 * no-op proprement si la piste a disparu entre-temps.
 */
async function placeSampleFromDrop(
  name: string, trackId: string, laneX: number): Promise<void> {
  const sample = await resolveSample(name);
  if (!sample || !ctx.project) {
    console.error(`drop refused: sample ${name} is not in the palette`);
    return;
  }
  // Garde de kind : un sample ne se pose pas sur une piste MIDI
  const tdef = ctx.project.getDocument().tracks.find((t) => t.id === trackId);
  if (tdef && !trackAcceptsAudio(tdef)) {
    const lane = laneOf(trackId);
    if (lane) flashLaneRefusal(lane,
      'Piste MIDI : un sample ne se pose pas ici');
    return;
  }
  const sr = ctx.project.getDocument().sampleRate || 48000;
  const dropStep = snapStep();  // la grille du zoom, comme les drags
  const seconds = Math.max(0,
    Math.round((laneX / TIMELINE.pps) / dropStep) * dropStep);
  const dropStart = Math.round(seconds * sr);
  // Anti-doublon meme-sample (le meme garde que le clic arme)
  if (tdef?.clips.some((c) => !c.sceneId && c.assetHash === sample.hash &&
      c.startSample === dropStart)) {
    const lane = laneOf(trackId);
    if (lane) flashLaneRefusal(lane,
      `« ${sample.name} » est deja pose exactement ici`);
    return;
  }
  const placedId = `clip-${sample.name}-${Date.now()}`;
  ctx.project.addClip(trackId, {
    id: placedId,
    assetHash: sample.hash,
    startSample: dropStart,
    lengthSamples: Math.round(sample.seconds * sr),
    offsetSamples: 0,
  });
  sendLastChange();
  renderTracks();
  markLanded(placedId);
}

let dndInstalled = false;
/**
 * Installe les cibles de drop sur #tracks (une fois - appele par
 * renderBrowser au montage du rail). Le feedback pendant dragover est
 * OBLIGATOIRE : piste surlignee, ou lisere "+ nouvelle piste" sur la zone
 * vide (styles/dnd.css).
 */
export function installBrowserDnd(): void {
  if (dndInstalled) return;
  dndInstalled = true;

  els.tracks.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(DND_MIME)) return;  // drag de fichier: pas notre role
    const isSample = e.dataTransfer.types.includes(DND_SAMPLE_MIME);
    const { trackEl, emptyZone } = dropTarget(e);
    clearDndFeedback();
    // Sample sur la zone vide : cible refusee (pas de preventDefault =
    // le navigateur montre l'interdit) - pas de lisere menteur.
    if (!trackEl && (isSample || !emptyZone)) return;
    // Garde de kind : sample au-dessus d'une piste MIDI = interdit
    // navigateur des le dragover (le seul payload lisible a ce stade).
    if (trackEl && isSample) {
      const t = ctx.project?.getDocument().tracks
        .find((x) => x.id === trackEl.getAttribute('data-track-id'));
      if (t && !trackAcceptsAudio(t)) return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (trackEl) trackEl.classList.add('dnd-drop-track');
    else els.tracks.classList.add('dnd-drop-new');
  });

  els.tracks.addEventListener('dragleave', (e) => {
    // Ne nettoyer qu'en SORTANT de #tracks (les dragleave internes pleuvent
    // a chaque changement d'enfant - le dragover suivant repose la classe).
    const to = e.relatedTarget as Node | null;
    if (!to || !els.tracks.contains(to)) clearDndFeedback();
  });

  els.tracks.addEventListener('drop', (e) => {
    const raw = e.dataTransfer?.getData(DND_MIME);
    if (!raw) return;  // pas notre drag (fichier WAV: wiring.ts s'en charge)
    e.preventDefault();
    clearDndFeedback();
    let payload: BrowserDragPayload;
    try {
      payload = JSON.parse(raw) as BrowserDragPayload;
    } catch {
      return;  // payload corrompu : drop ignore, jamais un crash
    }
    const { trackEl, emptyZone } = dropTarget(e);
    if (payload.kind === 'sample') {
      if (!trackEl) return;
      const lane = trackEl.querySelector('.track-lane') as HTMLElement | null;
      if (!lane) return;
      // Drop sur la tete de piste : x clampe a 0 (pose au debut)
      const laneX = Math.max(0, e.clientX - lane.getBoundingClientRect().left);
      void placeSampleFromDrop(payload.name,
        trackEl.getAttribute('data-track-id')!, laneX);
      return;
    }
    if (payload.kind === 'instrument' || payload.kind === 'effect') {
      if (!trackEl && !emptyZone) return;
      addDeviceFromDrop(payload, trackEl);
    }
  });

  // ---- Le RACK est aussi une cible (geste Ableton : deposer un plugin
  // dans la Device View, a une POSITION de la chaine). Samples refuses
  // (un sample n'est pas un device). Piste = celle que le rack affiche.
  els.deviceViewSlot.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(DND_MIME)) return;
    if (e.dataTransfer.types.includes(DND_SAMPLE_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    els.deviceViewSlot.classList.add('dnd-drop-rack');
  });
  els.deviceViewSlot.addEventListener('dragleave', (e) => {
    const to = e.relatedTarget as Node | null;
    if (!to || !els.deviceViewSlot.contains(to)) {
      els.deviceViewSlot.classList.remove('dnd-drop-rack');
    }
  });
  els.deviceViewSlot.addEventListener('drop', (e) => {
    const raw = e.dataTransfer?.getData(DND_MIME);
    els.deviceViewSlot.classList.remove('dnd-drop-rack');
    if (!raw) return;
    e.preventDefault();
    let payload: BrowserDragPayload;
    try { payload = JSON.parse(raw) as BrowserDragPayload; } catch { return; }
    if (payload.kind !== 'instrument' && payload.kind !== 'effect') return;
    const trackId = shownRackTrackId();
    if (!trackId) return;
    addDeviceToTrack(payload, trackId, rackInsertIndex(e.clientX));
  });

  // Un drag annule (Escape, lache hors cible) doit eteindre le feedback :
  // dragend arrive sur la SOURCE (les items du rail), on ecoute au document.
  document.addEventListener('dragend', clearDndFeedback);
}

/**
 * Product palette: the arm/click gesture as a generic gesture over the
 * PROJECT's assets.
 */
let lastPaletteKey = '\0unset';  // sentinel: an empty project still renders its hint
export function refreshPalette(): void {
  // Lab : la palette vient du kit embarque (wiring) - la SEULE chose a
  // faire ici est de rendre ses chips draggables (idempotent).
  if (LAB_MODE) {
    if (ctx.library) decorateSampleChips(ctx.library.element);
    return;
  }
  if (!ctx.project) return;
  const doc = ctx.project.getDocument();
  const sr = doc.sampleRate || 48000;
  const byHash = new Map<string, { name: string; seconds: number }>();
  for (const t of doc.tracks) {
    for (const c of t.clips) {
      const name = clipDisplayName(c);
      const prev = byHash.get(c.assetHash);
      const seconds = (c.lengthSamples ?? 0) / sr;
      if (!prev || seconds > prev.seconds) {
        byHash.set(c.assetHash, { name: prev?.name ?? name, seconds });
      }
    }
  }
  const key = [...byHash.keys()].sort().join(',');
  if (key === lastPaletteKey) return;
  lastPaletteKey = key;
  // F6 : les samples ne vivent plus dans l'arrangement (#library-slot vide) ;
  // la SOURCE UNIQUE est l'onglet Samples du navigateur, qui monte
  // ctx.library.element. On (re)construit la palette et on rafraichit le rail.
  document.getElementById('library-slot')!.innerHTML = '';
  if (byHash.size === 0) {
    ctx.library = null;
  } else {
    const kit: Kit = {
      sampleRate: sr,
      samples: [...byHash.entries()].map(([hash, v]) =>
        ({ name: v.name, hash, seconds: v.seconds })),
    };
    ctx.library = new Library(kit);
    // D3 : la meme source alimente la resolution des drops de samples
    // (nom -> hash/duree) et les chips deviennent draggables.
    samplesByName.clear();
    for (const s of kit.samples) samplesByName.set(s.name, s);
    decorateSampleChips(ctx.library.element);
  }
  renderBrowser();
}
