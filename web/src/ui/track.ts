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
import { clampSamples, cssId } from '../document/sanitize';
import { ctx } from '../app/context';  // V1.3: undo groups on fader sweeps

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
    // Human name, not the generated id: 'clip-kick-1787...' -> 'kick'
    nameStrip.textContent = clip.id.replace(/^clip-/, '').replace(/-\d+$/, '');
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
const KNOWN_VST3_NAMES: Record<string, string> = {
  [AGAIN_UID]: 'AGain',
  'ABCDEF019182FAEB4175446152523330': 'RoughRider3',
  '565354734D617376616C68616C6C6173': 'ValhallaSupermassive',
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
    if (!menu.hidden) uidInput.classList.remove('invalid');
  });
  gainBtn.addEventListener('click', () => {
    onAddDevice({
      id: `dev-${Date.now()}`, type: 'builtin.gain', bypass: false,
      params: [{ key: 'gain', value: 1 }],
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
    row.appendChild(label);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.dataset.role = 'param';
    slider.dataset.paramKey = p.key;
    slider.min = '0';
    slider.max = proc.type === 'vst3' ? '1' : '2';
    slider.step = '0.01';
    slider.value = String(p.value);
    slider.setAttribute('aria-label', `${proc.type} ${p.key}`);
    const valueEl = document.createElement('span');
    valueEl.className = 'param-value';
    valueEl.textContent = Number(p.value).toFixed(2);
    slider.addEventListener('input', () => {
      valueEl.textContent = Number(slider.value).toFixed(2);
      onParamChange(proc.id, p.key, parseFloat(slider.value));
    });
    row.appendChild(slider);
    row.appendChild(valueEl);
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
        panel.querySelector('.device-title')?.appendChild(stemBadge);
      }
      stemBadge.textContent = `STEM ${proc.stemHash.slice(0, 8)}`;
    }
    for (const p of proc.params) {
      const slider = panel.querySelector(
        `[data-role="param"][data-param-key="${cssId(p.key)}"]`) as HTMLInputElement | null;
      if (slider && document.activeElement !== slider) {
        slider.value = String(p.value);
        const valueEl = slider.nextElementSibling as HTMLElement | null;
        if (valueEl) valueEl.textContent = Number(p.value).toFixed(2);
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
