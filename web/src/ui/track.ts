// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Track UI components — la vraie UI (2026-08-22).
 *
 * Conventions adopted from docs/UI-CONVENTIONS.md (what Ableton, Cubase
 * and Logic already agree on):
 * - track color drives identity: color bar in the header, clip fill;
 * - the chain does NOT live in the header (Device View, see below);
 * - graceful degradation: an empty track is a compact strip;
 * - color = state, never decoration (mute orange, solo blue,
 *   bypass amber).
 *
 * SELECTION CONTRACT (tests anchor here, pixels stay free):
 *   [data-track-id], [data-role="gain"], [data-role="mute"/"solo"],
 *   [data-role="bypass"][data-proc-id] (in the Device View),
 *   [data-role="param"][data-param-key], data-state on pills.
 */

import type { TrackDef, ProcessorDef } from '../document/schema';
import { clipDisplayName } from '../document/schema';
import { clampSamples, cssId } from '../document/sanitize';
import { ctx } from '../app/context';  // V1.3: undo groups on fader sweeps

// ---- Fenetres de plugin ouvertes (bouton BOX) ---------------------------
// SOURCE DE VERITE locale de l'etat des fenetres GUI (procId). Survit aux
// re-rendus ; remise a zero quand le moteur part (ses enfants - et leurs
// fenetres - meurent avec lui).
const openEditors = new Set<string>();
export function isEditorOpen(procId: string): boolean {
  return openEditors.has(procId);
}
export function markEditorOpen(procId: string, open: boolean): void {
  if (open) openEditors.add(procId);
  else openEditors.delete(procId);
}
export function resetOpenEditors(): void {
  openEditors.clear();
}

/** Timeline scale, shared by tracks, ruler and playhead. */
export const TIMELINE = {
  pps: 20,          // pixels per second
  headWidth: 260,   // sticky track-head column, px (mirrors CSS flex-basis)
};

/** Track color: deterministic hue from the id (schema has no color field
 *  yet - adding one is a dedicated schema session; the hash keeps every
 *  peer seeing the SAME color without document support). */
export function trackHue(trackId: string): number {
  let h = 0;
  for (let i = 0; i < trackId.length; i++) h = (h * 31 + trackId.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

export function createTrackUI(
  track: TrackDef,
  sampleRate: number,
  laneSeconds: number,
  selected: boolean,
  onGainChange: (gain: number) => void,
  onMonitorToggle?: (kind: 'mute' | 'solo', on: boolean) => void,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'track';
  el.dataset.trackId = track.id;
  const hue = trackHue(track.id);
  // Color rides CSS variables so a single property modulates EVERYTHING
  // (touch mode C: saturation follows activity - the life layer writes
  // --sat only, a rebuild restores the base)
  el.dataset.hue = String(hue);
  el.style.setProperty('--hue', String(hue));
  el.style.setProperty('--sat', '45%');
  const isEmpty = track.clips.length === 0 && track.chain.length === 0;
  if (isEmpty) el.classList.add('track-empty');
  if (selected) el.classList.add('track-selected');

  const head = document.createElement('div');
  head.className = 'track-head';
  el.appendChild(head);

  // Color bar: the track's identity (drives the clip fill too)
  const colorBar = document.createElement('div');
  colorBar.className = 'track-color';
  colorBar.style.background = `hsl(${hue} var(--sat) 50%)`;
  head.appendChild(colorBar);

  const headBody = document.createElement('div');
  headBody.className = 'track-head-body';
  head.appendChild(headBody);

  // Title row: name + M/S + gain value
  const titleRow = document.createElement('div');
  titleRow.className = 'track-title-row';
  const nameEl = document.createElement('div');
  nameEl.className = 'track-name';
  nameEl.textContent = track.name;
  titleRow.appendChild(nameEl);

  const monitor = document.createElement('div');
  monitor.className = 'track-monitor';
  for (const kind of ['mute', 'solo'] as const) {
    const btn = document.createElement('button');
    btn.className = `monitor-btn monitor-${kind}`;
    btn.dataset.role = kind;
    btn.textContent = kind === 'mute' ? 'M' : 'S';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', `${kind} ${track.name}`);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();  // never steal the track-select click
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      onMonitorToggle?.(kind, on);
    });
    monitor.appendChild(btn);
  }
  titleRow.appendChild(monitor);
  headBody.appendChild(titleRow);

  // Fader row: slider + meter + dB value
  const faderContainer = document.createElement('div');
  faderContainer.className = 'track-fader';

  const faderInput = document.createElement('input');
  faderInput.type = 'range';
  faderInput.min = '0';
  faderInput.max = '2';
  faderInput.step = '0.01';
  faderInput.value = track.gain.toString();
  faderInput.dataset.role = 'gain';
  faderInput.setAttribute('aria-label', `Gain ${track.name}`);

  const gainDisplay = document.createElement('span');
  gainDisplay.className = 'track-gain';
  gainDisplay.textContent = formatGain(track.gain);

  faderInput.addEventListener('input', () => {
    const gain = parseFloat(faderInput.value);
    gainDisplay.textContent = formatGain(gain);
    // Touch mode A: the value pops on change (CSS decides if it shows)
    gainDisplay.classList.remove('pop');
    void gainDisplay.offsetWidth;  // restart the animation
    gainDisplay.classList.add('pop');
    onGainChange(gain);
  });
  faderInput.addEventListener('click', (e) => e.stopPropagation());
  // V1.3: one fader SWEEP = one undo entry (the input storm coalesces)
  faderInput.addEventListener('pointerdown', () => {
    ctx.project?.beginUndoGroup();
    window.addEventListener('pointerup',
      () => ctx.project?.endUndoGroup(), { once: true });
  });

  faderContainer.appendChild(faderInput);
  const meter = document.createElement('div');
  meter.className = 'track-meter';
  meter.id = `meter-${track.id}`;
  const meterFill = document.createElement('div');
  meterFill.className = 'track-meter-fill';
  meter.appendChild(meterFill);
  faderContainer.appendChild(meter);
  faderContainer.appendChild(gainDisplay);
  headBody.appendChild(faderContainer);

  // The time lane: clips inherit the track color, name strip on top
  const lane = document.createElement('div');
  lane.className = 'track-lane';
  lane.style.width = `${laneSeconds * TIMELINE.pps}px`;
  for (const clip of track.clips) {
    const clipEl = document.createElement('div');
    clipEl.className = 'clip';
    clipEl.dataset.clipId = clip.id;
    // Clamp document-derived spans (M5): a hostile lengthSamples must
    // not become a giant DOM node that freezes a peer.
    const startS = clampSamples(clip.startSample);
    const lenS = clampSamples(clip.lengthSamples);
    clipEl.style.left = `${(startS / sampleRate) * TIMELINE.pps}px`;
    clipEl.style.width = `${Math.max(2, (lenS / sampleRate) * TIMELINE.pps)}px`;
    clipEl.style.background = `hsl(${hue} var(--sat) 34%)`;
    clipEl.style.borderColor = `hsl(${hue} var(--sat) 52%)`;
    const nameStrip = document.createElement('div');
    nameStrip.className = 'clip-name';
    nameStrip.dataset.role = 'clip-handle';  // ONLY the title bar drags
    nameStrip.style.background = `hsl(${hue} var(--sat) 26%)`;
    // Human name, never the raw id (source unique : clipDisplayName)
    nameStrip.textContent = clipDisplayName(clip);
    clipEl.title = clip.assetHash;
    clipEl.appendChild(nameStrip);
    const wave = document.createElement('canvas');
    wave.className = 'clip-wave';
    wave.dataset.assetHash = clip.assetHash;
    // The waveform shows this clip's WINDOW of the asset (trims move it)
    wave.dataset.offsetSamples = String(clip.offsetSamples);
    wave.dataset.lengthSamples = String(clip.lengthSamples);
    clipEl.appendChild(wave);
    // Resize handles (C2): 6px edge zones, ew-resize affordance
    for (const side of ['left', 'right'] as const) {
      const edge = document.createElement('div');
      edge.className = `clip-edge clip-edge-${side}`;
      edge.dataset.role = 'clip-edge';
      edge.dataset.edge = side;
      clipEl.appendChild(edge);
    }
    // V1.6: fade shades (diagonal overlay = the ramp you hear) + top-
    // corner handles. Handles rule (CLAUDE.md): a plain click on a fade
    // handle SELECTS the clip - the branch exists from birth.
    const fadeInPx = ((clip.fadeInSamples ?? 0) / sampleRate) * TIMELINE.pps;
    const fadeOutPx = ((clip.fadeOutSamples ?? 0) / sampleRate) * TIMELINE.pps;
    for (const side of ['in', 'out'] as const) {
      const px = side === 'in' ? fadeInPx : fadeOutPx;
      const shade = document.createElement('div');
      shade.className = `clip-fade clip-fade-${side}`;
      shade.style.width = `${px}px`;
      clipEl.appendChild(shade);
      const fh = document.createElement('div');
      fh.className = `fade-handle fade-handle-${side}`;
      fh.dataset.role = 'fade-handle';
      fh.dataset.side = side;
      fh.title = side === 'in' ? 'Fade in' : 'Fade out';
      if (side === 'in') fh.style.left = `${px}px`;
      else fh.style.right = `${px}px`;
      clipEl.appendChild(fh);
    }
    lane.appendChild(clipEl);
  }
  el.appendChild(lane);

  return el;
}

/**
 * Build the ruler row, SPLIT (Logic/Ableton convention): the upper band
 * is reserved for the future loop/cycle brace (inert today), the lower
 * band is the seek strip - the ONLY place a click seeks.
 */
export function createRulerUI(laneSeconds: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ruler-row';
  const spacer = document.createElement('div');
  spacer.className = 'ruler-spacer';
  spacer.textContent = 'tracks';
  row.appendChild(spacer);
  const ruler = document.createElement('div');
  ruler.className = 'ruler';
  ruler.style.width = `${laneSeconds * TIMELINE.pps}px`;
  const cycleBand = document.createElement('div');
  cycleBand.className = 'ruler-cycle';
  ruler.appendChild(cycleBand);
  const seekBand = document.createElement('div');
  seekBand.className = 'ruler-seek';
  seekBand.dataset.role = 'seek';
  for (let s = 0; s <= laneSeconds; s += 1) {
    const tick = document.createElement('div');
    tick.className = 'ruler-tick';
    tick.style.left = `${s * TIMELINE.pps}px`;
    if (s % 5 === 0) tick.textContent = `${s}s`;
    seekBand.appendChild(tick);
  }
  ruler.appendChild(seekBand);
  row.appendChild(ruler);
  return row;
}

/**
 * DEVICE VIEW (Ableton convention): the bottom band shows the SELECTED
 * track's chain, left to right. One device = a panel with a round
 * bypass toggle in its title bar and a generic slider body (the
 * host-drawn view every DAW falls back to).
 */
export function createDeviceView(
  track: TrackDef | null,
  onBypassToggle: (procId: string, bypass: boolean) => void,
  onParamChange: (procId: string, key: string, value: number) => void,
  onAddDevice?: (proc: ProcessorDef) => void,
  onRemoveDevice?: (procId: string) => void,
): HTMLElement {
  const view = document.createElement('div');
  view.className = 'device-view';
  view.id = 'device-view';

  const header = document.createElement('div');
  header.className = 'device-view-title';
  const titleText = document.createElement('span');
  titleText.textContent = track ? `Devices — ${track.name}` : 'Devices';
  header.appendChild(titleText);
  if (track && onAddDevice) {
    header.appendChild(createAddDeviceMenu(onAddDevice));
  }
  view.appendChild(header);

  const chainEl = document.createElement('div');
  chainEl.className = 'device-chain';
  view.appendChild(chainEl);

  if (!track) return view;

  for (const proc of track.chain) {
    chainEl.appendChild(
      createDevicePanel(proc, onBypassToggle, onParamChange, onRemoveDevice));
    // T3 : mini-VU inter-device apres chaque device (alimente par onMeters
    // qui cible data-proc-id). Le differenciateur : le niveau apres CHAQUE
    // plugin, lisible d'un coup d'oeil - qu'aucun DAW grand public n'offre.
    const vu = document.createElement('div');
    vu.className = 'device-vu';
    vu.dataset.procId = proc.id;
    vu.title = 'niveau apres ce device';
    vu.appendChild(document.createElement('i'));
    chainEl.appendChild(vu);
  }
  if (track.chain.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'device-empty';
    empty.textContent = 'no devices';
    chainEl.appendChild(empty);
  }
  return view;
}

/** AGain (the vendored debug plugin) - the natural prefill for the uid field. */
const AGAIN_UID = '84E8DE5F92554F5396FAE4133C935A18';
const VST3_UID_RE = /^[0-9A-Fa-f]{32}$/;
/** Convenance d'affichage pour les uid deja croises sur cette machine -
 *  le champ name du document reste la verite (2.5-decouverte remplacera
 *  cette table par le scan). */
// 2.5-decouverte : le catalogue scanne par le moteur (recu a l'auth).
// Effets seulement au menu - l'hote est Fx-only (stereo in/out) tant que
// le bus INSTRUMENT n'existe pas (vague 3).
type CatalogEntry = { uid: string; name: string; vendor: string; subCategories: string };
let pluginCatalog: CatalogEntry[] = [];
export function setPluginCatalog(entries: CatalogEntry[]): void {
  pluginCatalog = entries;
}

// Session 3 (fraicheur, arbitrage b) : le PRODUCTEUR diffuse sf:1 sur
// le canal ephemere (2 s) ; sans signal recent, le badge dit
// « fraicheur inconnue » — il ne ment jamais par omission.
const stemFreshness = new Map<string, { fresh: boolean; at: number }>();
export function noteStemFreshness(nodes: Record<string, { f: boolean }>): void {
  const at = performance.now();
  for (const [id, v] of Object.entries(nodes)) {
    stemFreshness.set(id, { fresh: !!v.f, at });
  }
  refreshStemBadges();
}
export function refreshStemBadges(): void {
  const now = performance.now();
  document.querySelectorAll<HTMLElement>('[data-role="device-stem"]').forEach((el) => {
    const e = stemFreshness.get(el.dataset.procId ?? '');
    const state = e && now - e.at < 7000 ? (e.fresh ? 'fresh' : 'stale') : 'unknown';
    el.dataset.fresh = state;
    el.title = state === 'fresh'
      ? 'Stem a jour : un pair sans ce plugin entend exactement ce rendu'
      : state === 'stale'
        ? 'STEM PERIME : un reglage a change, le producteur re-rend'
        : 'Fraicheur inconnue : aucun producteur de ce stem en vie';
  });
}

// Session 4.1 (effets natifs) : UNITES VRAIES au panneau - le brief
// interdit le 0-1 nu. Chaque param natif declare bornes + formatteur.
type ParamSpec = {
  min: number; max: number; step: number; fmt: (v: number) => string;
};
const NATIVE_PARAM_SPECS: Record<string, Record<string, ParamSpec>> = {
  'builtin.gain': {
    gain: { min: 0, max: 2, step: 0.01, fmt: (v) => formatGain(v) },
  },
  'builtin.utility': {
    gain: { min: 0, max: 2, step: 0.01, fmt: (v) => formatGain(v) },
    pan: {
      min: -1, max: 1, step: 0.01,
      fmt: (v) => (Math.abs(v) < 0.005 ? 'C'
        : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`),
    },
    mono: { min: 0, max: 1, step: 1, fmt: (v) => (v >= 0.5 ? 'mono' : 'stereo') },
    phase: { min: 0, max: 1, step: 1, fmt: (v) => (v >= 0.5 ? 'inv' : 'nor') },
  },
  'builtin.eq3': {
    lowGainDb: { min: -15, max: 15, step: 0.1, fmt: (v) => `${v.toFixed(1)} dB` },
    lowFreq: { min: 20, max: 500, step: 1, fmt: (v) => `${Math.round(v)} Hz` },
    peakGainDb: { min: -15, max: 15, step: 0.1, fmt: (v) => `${v.toFixed(1)} dB` },
    peakFreq: { min: 100, max: 8000, step: 10, fmt: (v) => `${Math.round(v)} Hz` },
    peakQ: { min: 0.3, max: 4, step: 0.05, fmt: (v) => `Q ${v.toFixed(2)}` },
    highGainDb: { min: -15, max: 15, step: 0.1, fmt: (v) => `${v.toFixed(1)} dB` },
    highFreq: { min: 1000, max: 16000, step: 50, fmt: (v) => `${Math.round(v)} Hz` },
  },
  'builtin.comp': {
    thresholdDb: { min: -60, max: 0, step: 0.5, fmt: (v) => `${v.toFixed(1)} dB` },
    ratio: { min: 1, max: 20, step: 0.1, fmt: (v) => `${v.toFixed(1)}:1` },
    attackMs: { min: 0.1, max: 100, step: 0.1, fmt: (v) => `${v.toFixed(1)} ms` },
    releaseMs: { min: 5, max: 1000, step: 5, fmt: (v) => `${Math.round(v)} ms` },
    makeupDb: { min: 0, max: 24, step: 0.5, fmt: (v) => `+${v.toFixed(1)} dB` },
  },
  'builtin.drive': {
    driveDb: { min: 0, max: 36, step: 0.5, fmt: (v) => `+${v.toFixed(1)} dB` },
    levelDb: { min: -24, max: 6, step: 0.5, fmt: (v) => `${v.toFixed(1)} dB` },
    mix: { min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)} %` },
  },
  'builtin.delay': {
    timeMs: { min: 1, max: 2000, step: 1, fmt: (v) => `${Math.round(v)} ms` },
    feedback: { min: 0, max: 0.95, step: 0.01, fmt: (v) => `${Math.round(v * 100)} %` },
    mix: { min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)} %` },
  },
};

const KNOWN_VST3_NAMES: Record<string, string> = {
  [AGAIN_UID]: 'AGain',
  'ABCDEF019182FAEB4175446152523330': 'RoughRider3',
  '565354734D617376616C68616C6C6173': 'ValhallaSupermassive',
  // Palette 2026-08-24 (enumeres sur cette machine, 15/15)
  '565354746B4B726B7275736800000000': 'Krush',
  'ABCDEF019182FAEB5369787445666679': 'Deelay',
  '5653544671456876616C68616C6C6166': 'ValhallaFreqEcho',
  '56535453704D6476616C68616C6C6173': 'ValhallaSpaceModulator',
  '584EDC40D3864AA19F0CD33B971765B1': 'SPAN',
  '5653544E6924517261756D0000000000': 'Raum',
  '5653544E6924427265706C696B610000': 'Replika',
  '5653544E69244A706861736973000000': 'Phasis',
  '5653544E69244B666C61697200000000': 'Flair',
  '5653544E69244963686F72616C000000': 'Choral',
  '5653544E69244C646972740000000000': 'Dirt',
  '5653544E69243D647269766572000000': 'Driver',
  '5653544E69244E667265616B00000000': 'Freak',
  '5653544E69244D626974650000000000': 'Bite',
  'ABCDEF019182FAEB4361626C43485431': 'HalfTime',
};

/**
 * V1.5: the `+ device` control. Click opens a small inline menu:
 * builtin.gain adds instantly; vst3 reveals a uid field (32 hex,
 * AGain prefilled) validated BEFORE anything touches the document.
 */
function createAddDeviceMenu(onAddDevice: (proc: ProcessorDef) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'device-add';

  const btn = document.createElement('button');
  btn.id = 'add-device-btn';
  btn.className = 'device-add-btn';
  btn.textContent = '+ device';
  btn.setAttribute('aria-expanded', 'false');
  wrap.appendChild(btn);

  const menu = document.createElement('div');
  menu.className = 'device-add-menu';
  menu.id = 'device-add-menu';
  menu.hidden = true;
  wrap.appendChild(menu);

  const gainBtn = document.createElement('button');
  gainBtn.dataset.role = 'add-gain';
  gainBtn.textContent = 'gain (builtin)';
  menu.appendChild(gainBtn);

  // Session 4.1 : Utility - le device de cablage natif (gain/pan/mono/
  // phase), present sur toutes les machines par construction
  const utilBtn = document.createElement('button');
  utilBtn.dataset.role = 'add-utility';
  utilBtn.textContent = 'utility (builtin)';
  menu.appendChild(utilBtn);

  // Session 4.2 : EQ 3 bandes + compresseur natifs
  const eqBtn = document.createElement('button');
  eqBtn.dataset.role = 'add-eq3';
  eqBtn.textContent = 'eq 3 bandes (builtin)';
  menu.appendChild(eqBtn);
  const compBtn = document.createElement('button');
  compBtn.dataset.role = 'add-comp';
  compBtn.textContent = 'compresseur (builtin)';
  menu.appendChild(compBtn);
  // Session 4.3 : drive (oversample 4x) + delay natifs
  const driveBtn = document.createElement('button');
  driveBtn.dataset.role = 'add-drive';
  driveBtn.textContent = 'drive (builtin)';
  menu.appendChild(driveBtn);
  const delayBtn = document.createElement('button');
  delayBtn.dataset.role = 'add-delay';
  delayBtn.textContent = 'delay (builtin)';
  menu.appendChild(delayBtn);

  // 2.5-decouverte : le catalogue du moteur, effets tries par nom.
  // Choisir remplit uid+nom ; le champ uid reste la voie experte.
  const catalogSelect = document.createElement('select');
  catalogSelect.id = 'vst3-catalog-select';
  catalogSelect.setAttribute('aria-label', 'Catalogue de plugins scannes');
  menu.appendChild(catalogSelect);

  const vstRow = document.createElement('div');
  vstRow.className = 'device-add-vst';
  const uidInput = document.createElement('input');
  uidInput.type = 'text';
  uidInput.id = 'vst3-uid-input';
  uidInput.value = AGAIN_UID;
  uidInput.spellcheck = false;
  uidInput.setAttribute('aria-label', 'VST3 class uid (32 hex)');
  vstRow.appendChild(uidInput);
  // Nom d'affichage (bible Ableton : chaque device a sa barre de titre).
  // Pre-rempli depuis les uid connus ; libre sinon.
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'vst3-name-input';
  nameInput.placeholder = 'nom';
  nameInput.value = KNOWN_VST3_NAMES[AGAIN_UID] ?? '';
  nameInput.spellcheck = false;
  nameInput.setAttribute('aria-label', 'Nom du device');
  uidInput.addEventListener('input', () => {
    const known = KNOWN_VST3_NAMES[uidInput.value.trim().toUpperCase()];
    if (known) nameInput.value = known;
  });
  vstRow.appendChild(nameInput);
  const vstBtn = document.createElement('button');
  vstBtn.dataset.role = 'add-vst3';
  vstBtn.textContent = 'vst3';
  vstRow.appendChild(vstBtn);
  menu.appendChild(vstRow);

  const close = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
    if (!menu.hidden) {
      // 2026-08-27 : le menu est en position FIXED cale sur le bouton -
      // en absolute DANS le scroller du rack (panneau bas de ~260px), il
      // etait TRONQUE par l'overflow, et tout clic dedans (humain qui
      // scrolle, Playwright qui actionne) laissait le rack scrolle hors
      // champ (devices a x negatif - vu en spec). Fixed = jamais clippe.
      const r = btn.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.left = `${r.left}px`;
      const below = r.bottom + 4;
      const h = Math.min(window.innerHeight * 0.6, 420);
      menu.style.top = below + h <= window.innerHeight
        ? `${below}px` : `${Math.max(8, r.top - h - 4)}px`;
      menu.style.maxHeight = `${h}px`;
      menu.style.overflowY = 'auto';
      uidInput.classList.remove('invalid');
      // Le catalogue au moment de l'OUVERTURE (il arrive apres l'auth)
      // v8 : effets ET instruments. Un instrument (subcat Instrument/Synth)
      // genere le son a partir de notes ; on le tague pour le distinguer.
      const isInst = (e: CatalogEntry) =>
        e.subCategories.includes('Instrument') || e.subCategories.includes('Synth');
      const usable = pluginCatalog
        .filter((e) => e.subCategories.includes('Fx') || isInst(e))
        .sort((a, b) => {
          // instruments d'abord (ce sont les sources), puis effets, par nom
          const ai = isInst(a) ? 0 : 1, bi = isInst(b) ? 0 : 1;
          return ai !== bi ? ai - bi : a.name.localeCompare(b.name);
        });
      catalogSelect.innerHTML = '';
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = usable.length
        ? `— catalogue (${usable.length}) —`
        : '— catalogue vide (moteur sans --vst3-dir) —';
      catalogSelect.appendChild(ph);
      for (const e of usable) {
        const o = document.createElement('option');
        o.value = e.uid;
        o.textContent = `${isInst(e) ? '[inst] ' : ''}${e.name}  (${e.vendor})`;
        catalogSelect.appendChild(o);
      }
    }
  });
  catalogSelect.addEventListener('change', () => {
    const e = pluginCatalog.find((x) => x.uid === catalogSelect.value);
    if (!e) return;
    uidInput.value = e.uid;
    nameInput.value = e.name;
    uidInput.classList.remove('invalid');
  });
  gainBtn.addEventListener('click', () => {
    onAddDevice({
      id: `dev-${Date.now()}`, type: 'builtin.gain', bypass: false,
      params: [{ key: 'gain', value: 1 }],
    });
    close();
  });
  utilBtn.addEventListener('click', () => {
    onAddDevice({
      id: `dev-${Date.now()}`, type: 'builtin.utility', name: 'Utility',
      bypass: false,
      params: [
        { key: 'gain', value: 1 }, { key: 'pan', value: 0 },
        { key: 'mono', value: 0 }, { key: 'phase', value: 0 },
      ],
    });
    close();
  });
  eqBtn.addEventListener('click', () => {
    onAddDevice({
      id: `dev-${Date.now()}`, type: 'builtin.eq3', name: 'EQ Three',
      bypass: false,
      params: [
        { key: 'lowGainDb', value: 0 }, { key: 'lowFreq', value: 120 },
        { key: 'peakGainDb', value: 0 }, { key: 'peakFreq', value: 1000 },
        { key: 'peakQ', value: 0.9 },
        { key: 'highGainDb', value: 0 }, { key: 'highFreq', value: 6000 },
      ],
    });
    close();
  });
  compBtn.addEventListener('click', () => {
    onAddDevice({
      id: `dev-${Date.now()}`, type: 'builtin.comp', name: 'Compressor',
      bypass: false,
      params: [
        { key: 'thresholdDb', value: -24 }, { key: 'ratio', value: 4 },
        { key: 'attackMs', value: 10 }, { key: 'releaseMs', value: 100 },
        { key: 'makeupDb', value: 0 },
      ],
    });
    close();
  });
  driveBtn.addEventListener('click', () => {
    onAddDevice({
      id: `dev-${Date.now()}`, type: 'builtin.drive', name: 'Drive',
      bypass: false,
      params: [
        { key: 'driveDb', value: 12 }, { key: 'levelDb', value: -6 },
        { key: 'mix', value: 1 },
      ],
    });
    close();
  });
  delayBtn.addEventListener('click', () => {
    onAddDevice({
      id: `dev-${Date.now()}`, type: 'builtin.delay', name: 'Delay',
      bypass: false,
      params: [
        { key: 'timeMs', value: 350 }, { key: 'feedback', value: 0.35 },
        { key: 'mix', value: 0.35 },
      ],
    });
    close();
  });
  vstBtn.addEventListener('click', () => {
    const uid = uidInput.value.trim();
    if (!VST3_UID_RE.test(uid)) {
      // Invalid uid never reaches the document (peers would spawn a
      // child toward a module that cannot resolve)
      uidInput.classList.add('invalid');
      uidInput.title = '32 caracteres hexadecimaux attendus';
      return;
    }
    const label = nameInput.value.trim();
    onAddDevice({
      id: `dev-${Date.now()}`, type: 'vst3', uid: uid.toUpperCase(),
      ...(label ? { name: label } : {}),
      bypass: false, params: [],
    });
    close();
  });
  uidInput.addEventListener('input', () => uidInput.classList.remove('invalid'));

  return wrap;
}

/**
 * F4 : un knob rotatif qui PILOTE un <input type=range> (la source de
 * verite - le contrat data-role=param reste intact). Drag vertical facon
 * DAW (haut = +, 180 px = pleine course), clavier (fleches), et sync
 * visuel sur chaque event `input` du slider (donc aussi les maj distantes,
 * cf. updateDeviceViewUI qui appelle __knobSync apres avoir ecrit .value).
 * Clic sans mouvement = aucun effet (regle d'ergonomie des poignees).
 */
function createKnob(input: HTMLInputElement): HTMLElement {
  const min = Number(input.min || 0);
  const max = Number(input.max || 1);
  const step = Number(input.step || 0.01) || 0.01;
  const SWEEP = 270;  // deg (-135..+135)
  const wrap = document.createElement('div');
  wrap.className = 'knob';
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'slider');
  wrap.setAttribute('aria-valuemin', String(min));
  wrap.setAttribute('aria-valuemax', String(max));
  const dial = document.createElement('div');
  dial.className = 'knob-dial';
  const ptr = document.createElement('div');
  ptr.className = 'knob-pointer';
  dial.appendChild(ptr);
  wrap.appendChild(dial);

  const sync = (): void => {
    const t = max > min ? (Number(input.value) - min) / (max - min) : 0;
    const clamped = Math.max(0, Math.min(1, t));
    ptr.style.transform = `rotate(${-135 + clamped * SWEEP}deg)`;
    dial.style.setProperty('--fill', `${clamped * SWEEP}deg`);
    wrap.setAttribute('aria-valuenow', input.value);
  };
  (input as unknown as { __knobSync?: () => void }).__knobSync = sync;
  input.addEventListener('input', sync);

  const commit = (nv: number): void => {
    const clamped = Math.max(min, Math.min(max, nv));
    const snapped = Math.round(clamped / step) * step;
    const str = String(Number(snapped.toFixed(6)));
    if (str === input.value) return;
    input.value = str;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  let dragging = false;
  let startY = 0;
  let startV = 0;
  wrap.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startV = Number(input.value);
    wrap.setPointerCapture(e.pointerId);
    e.preventDefault();
    wrap.focus();  // pour que updateDeviceViewUI ne combatte pas la main
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    commit(startV + ((startY - e.clientY) / 180) * (max - min));
  });
  const end = (e: PointerEvent): void => {
    dragging = false;
    try { wrap.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  wrap.addEventListener('keydown', (e) => {
    let d = 0;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') d = step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') d = -step;
    else if (e.key === 'PageUp') d = step * 10;
    else if (e.key === 'PageDown') d = -step * 10;
    else return;
    e.preventDefault();
    commit(Number(input.value) + d);
  });

  sync();
  return wrap;
}

function createDevicePanel(
  proc: ProcessorDef,
  onBypassToggle: (procId: string, bypass: boolean) => void,
  onParamChange: (procId: string, key: string, value: number) => void,
  onRemoveDevice?: (procId: string) => void,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'device';
  panel.dataset.procId = proc.id;

  const title = document.createElement('div');
  title.className = 'device-title';
  const toggle = document.createElement('button');
  toggle.className = 'device-toggle';
  toggle.dataset.role = 'bypass';
  toggle.dataset.procId = proc.id;
  // aria-pressed = BYPASSED (document state); the round toggle LOOKS lit
  // when the device is ACTIVE (Ableton's activator), CSS inverts it
  toggle.setAttribute('aria-pressed', proc.bypass ? 'true' : 'false');
  toggle.setAttribute('aria-label', `Bypass ${proc.type}`);
  toggle.addEventListener('click', () => {
    const bypassed = toggle.getAttribute('aria-pressed') === 'true';
    onBypassToggle(proc.id, !bypassed);
  });
  title.appendChild(toggle);
  const name = document.createElement('span');
  name.className = 'device-name';
  // Bible Ableton : la barre de titre porte le NOM du device. Les vieux
  // devices sans champ name retombent sur l'uid court (jamais un mensonge
  // - l'ancien libelle disait AGain quel que soit le plugin).
  name.textContent = proc.name ??
    (proc.type === 'vst3'
      ? (KNOWN_VST3_NAMES[proc.uid ?? ''] ?? `vst3 ${(proc.uid ?? '').slice(0, 8)}`)
      : proc.type);
  title.appendChild(name);

  // Editor button (vst3 only): toggle the plugin's native GUI window on
  // demand (per node). L'etat vit dans openEditors (module) - PAS dans le
  // DOM : avant, chaque renderTracks reconstruisait le bouton a 'false'
  // alors que la fenetre restait ouverte, et le clic suivant renvoyait
  // « open » au lieu de fermer (bouton menteur, casse 2026-08-26).
  if (proc.type === 'vst3') {
    const ed = document.createElement('button');
    ed.className = 'device-editor';
    ed.dataset.role = 'editor';
    ed.dataset.procId = proc.id;
    ed.setAttribute('aria-pressed', isEditorOpen(proc.id) ? 'true' : 'false');
    ed.textContent = '⊞ BOX';  // la fenetre du plugin, a la demande (F1)
    ed.title = 'Ouvrir / fermer la fenetre du plugin';
    ed.addEventListener('click', () => {
      const open = !isEditorOpen(proc.id);
      markEditorOpen(proc.id, open);
      ed.setAttribute('aria-pressed', open ? 'true' : 'false');
      panel.dispatchEvent(new CustomEvent('editor-toggle', {
        detail: { procId: proc.id, open }, bubbles: true,
      }));
    });
    title.appendChild(ed);
    // Geste Ableton-like (vague « gestes complets » 2026-08-27) : le
    // DOUBLE-CLIC sur la barre de titre ouvre/ferme la fenetre du plugin -
    // le geste le plus decouvrable ; le drag D2 garde son seuil de 5 px,
    // les boutons de la barre gardent leurs clics (exclus).
    title.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('button, input, .knob')) return;
      ed.click();
    });
  }

  // 2.5-etat: the engine-captured state, visible (8 hex of the blob
  // hash + version). Absent until the hosting machine first captures.
  if (proc.stateHash) {
    const state = document.createElement('span');
    state.className = 'device-state';
    state.dataset.role = 'device-state';
    state.textContent = `✓ ${proc.stateHash.slice(0, 8)} v${proc.stateVersion ?? 0}`;
    state.title = `Etat du plugin capture par l'hote (blob ${proc.stateHash.slice(0, 8)}..., version ${proc.stateVersion ?? 0})`;
    title.appendChild(state);
  }
  // S7: the stem badge - THE invariant made visible. A peer without
  // this plugin plays exactly this rendered truth.
  if (proc.stemHash) {
    const stem = document.createElement('span');
    stem.className = 'device-stem';
    stem.dataset.role = 'device-stem';
    stem.dataset.procId = proc.id;   // fraicheur : le signal sf cible par id
    stem.textContent = `STEM ${proc.stemHash.slice(0, 8)}`;
    stem.title = `Stem publie (${proc.stemHash.slice(0, 8)}...) : un pair sans ce plugin entend ce rendu`;
    title.appendChild(stem);
  }

  // V1.5: removal is a TWO-STEP button (armed on first click, fires on
  // the second, disarms after 3 s or on Escape) - keyboard-safe, no
  // blocking dialog; Ctrl+Z restores the device anyway.
  if (onRemoveDevice) {
    const rm = document.createElement('button');
    rm.className = 'device-remove';
    rm.dataset.role = 'remove-device';
    rm.dataset.procId = proc.id;
    rm.textContent = '✕';
    rm.setAttribute('aria-label', `Retirer ${proc.type}`);
    let disarmTimer: number | undefined;
    const disarm = () => {
      rm.classList.remove('armed');
      rm.textContent = '✕';
      if (disarmTimer !== undefined) { clearTimeout(disarmTimer); disarmTimer = undefined; }
    };
    rm.addEventListener('click', () => {
      if (rm.classList.contains('armed')) {
        disarm();
        onRemoveDevice(proc.id);
      } else {
        rm.classList.add('armed');
        rm.textContent = 'sur ?';
        disarmTimer = window.setTimeout(disarm, 3000);
      }
    });
    rm.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { disarm(); e.stopPropagation(); }
    });
    rm.addEventListener('blur', disarm);
    title.appendChild(rm);
  }
  panel.appendChild(title);

  // Generic parameter body: labeled horizontal sliders (the universal
  // host-drawn fallback; capped by nature - our params are few)
  const body = document.createElement('div');
  body.className = 'device-body';
  for (const p of proc.params) {
    const row = document.createElement('div');
    row.className = 'param-row';
    const label = document.createElement('span');
    label.className = 'param-label';
    label.textContent = proc.type === 'vst3' ? `p${p.key}` : p.key;
    // Session 4.1 : unites vraies quand le device declare ses specs
    // (dB, L/R, mono/stereo, inv) - le 0-1 nu reste le repli vst3
    const spec = NATIVE_PARAM_SPECS[proc.type]?.[p.key];
    const fmt = spec?.fmt ?? ((v: number) => v.toFixed(2));
    // F4 : le <input range> reste la SOURCE DE VERITE (contrat : le JS lit
    // .value par data-role=param ; onParamChange = l'unique entonnoir).
    // Il est masque (CSS) et pilote par un knob rotatif visuel.
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.dataset.role = 'param';
    slider.dataset.paramKey = p.key;
    slider.min = String(spec?.min ?? 0);
    slider.max = String(spec?.max ?? (proc.type === 'vst3' ? 1 : 2));
    slider.step = String(spec?.step ?? 0.01);
    slider.value = String(p.value);
    slider.setAttribute('aria-label', `${proc.type} ${p.key}`);
    slider.className = 'param-input';
    const valueEl = document.createElement('span');
    valueEl.className = 'param-value';
    valueEl.textContent = fmt(Number(p.value));
    slider.addEventListener('input', () => {
      valueEl.textContent = fmt(Number(slider.value));
      onParamChange(proc.id, p.key, parseFloat(slider.value));
    });
    const knob = createKnob(slider);
    // ordre DOM : knob, value, label, slider(masque). Le knob refait sa
    // rotation sur chaque event input du slider (drag local ET maj distante).
    row.append(knob, valueEl, label, slider);
    body.appendChild(row);
  }
  panel.appendChild(body);
  return panel;
}

/**
 * Update an existing track's gain UI in place (no DOM rebuild).
 * Skips the slider if the user is currently holding it.
 */
export function updateTrackGainUI(trackId: string, gain: number): void {
  const el = document.querySelector(`[data-track-id="${cssId(trackId)}"]`);
  if (!el) return;
  const input = el.querySelector('[data-role="gain"]') as HTMLInputElement | null;
  if (input && document.activeElement !== input) {
    input.value = gain.toString();
  }
  const display = el.querySelector('.track-gain') as HTMLElement | null;
  if (display) {
    display.textContent = formatGain(gain);
  }
}

/**
 * Update the Device View's states in place for remote changes (bypass
 * buttons and param sliders settle through the document).
 */
export function updateDeviceViewUI(chain: ProcessorDef[]): void {
  const view = document.getElementById('device-view');
  if (!view) return;
  for (const proc of chain) {
    const toggle = view.querySelector(
      `[data-role="bypass"][data-proc-id="${cssId(proc.id)}"]`) as HTMLElement | null;
    if (toggle) {
      toggle.setAttribute('aria-pressed', proc.bypass ? 'true' : 'false');
    }
    const panel = view.querySelector(
      `.device[data-proc-id="${cssId(proc.id)}"]`) as HTMLElement | null;
    if (!panel) continue;
    // 2.5-etat: the state badge settles in place (first capture CREATES
    // it - the engine's change arrives without a structural rebuild)
    if (proc.stateHash) {
      let badge = panel.querySelector('[data-role="device-state"]') as HTMLElement | null;
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'device-state';
        badge.dataset.role = 'device-state';
        panel.querySelector('.device-title')?.appendChild(badge);
      }
      badge.textContent = `✓ ${proc.stateHash.slice(0, 8)} v${proc.stateVersion ?? 0}`;
    }
    // S7: the stem badge settles in place too
    if (proc.stemHash) {
      let stemBadge = panel.querySelector('[data-role="device-stem"]') as HTMLElement | null;
      if (!stemBadge) {
        stemBadge = document.createElement('span');
        stemBadge.className = 'device-stem';
        stemBadge.dataset.role = 'device-stem';
        // Jumeau attrape (session 3) : le badge cree A L'ARRIVEE du stem
        // n'avait pas le procId - la fraicheur le cherchait par '' et
        // repondait « inconnue » a vie. Les DEUX createurs le posent.
        stemBadge.dataset.procId = proc.id;
        panel.querySelector('.device-title')?.appendChild(stemBadge);
      }
      stemBadge.textContent = `STEM ${proc.stemHash.slice(0, 8)}`;
    }
    for (const p of proc.params) {
      const slider = panel.querySelector(
        `[data-role="param"][data-param-key="${cssId(p.key)}"]`) as HTMLInputElement | null;
      const row = slider?.closest('.param-row') ?? null;
      // F4 : ne pas combattre la main sur le knob (le knob prend le focus au
      // pointerdown) ; le slider lui-meme est masque et jamais focus.
      if (slider && !row?.contains(document.activeElement)) {
        slider.value = String(p.value);
        const valueEl = row?.querySelector('.param-value') as HTMLElement | null;
        // Meme formatteur que le createur (regle des jumeaux)
        const fmt = NATIVE_PARAM_SPECS[proc.type]?.[p.key]?.fmt ??
          ((v: number) => v.toFixed(2));
        if (valueEl) valueEl.textContent = fmt(Number(p.value));
        // le knob refait sa rotation depuis la nouvelle .value
        (slider as unknown as { __knobSync?: () => void }).__knobSync?.();
      }
    }
  }
}

/** Format gain value for display (exported for the master strip, V1.2). */
export function formatGain(gain: number): string {
  if (gain === 0) return '-inf';
  const db = 20 * Math.log10(gain);
  return `${db.toFixed(1)} dB`;
}
