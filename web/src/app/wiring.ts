// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Wiring: clients, event listeners, keyboard - init() assembles the
 * app from the split modules. No business logic lives here; each
 * handler delegates to its module.
 */

import { Project } from '../document/project';
import { ServerClient } from '../network/server_client';
import { EngineClient } from '../network/engine_client';
import { TIMELINE, formatGain, setPluginCatalog, noteStemFreshness,
         refreshStemBadges } from '../ui/track';
import * as life from '../ui/life';
import { formatTime } from '../ui/transport';
import { Library, loadKit } from '../ui/library';
import { Overview } from '../ui/overview';
import { mountStarter } from '../ui/starter';
import {
  ctx, els, sendLastChange,
  SERVER_URL, SERVER_TOKEN, ENGINE_PORT, PROJECT_ID, LAB_MODE,
} from './context';
import {
  setZoom, fitAll, snapStep, contentSeconds,
  updateInsertMarker, refreshOverview, updateFollowUI,
} from './navigation';
import { startPlayback, stopPlayback } from './transport';
import { beginClipDrag, beginClipResize, beginFadeDrag, markLanded } from './gestures';
import { toggleHelp, isHelpOpen } from '../ui/help';
import { JamChannel } from '../network/jam';
import { JamAudio } from '../network/jam_audio';
import { SessionClock } from '../network/session_clock';
import { Presence } from '../network/presence';
import { renderPresence } from './presence_view';
import { renderBrowser } from '../ui/browser';
import { initParadigm } from './paradigm';
import { initSplitters } from './splitters';
import { TransportSync } from '../network/transport_sync';
import { handleFileDrop } from './placement';
import { renderTracks } from './render';

declare global {
  interface Window {
    __dawProject: Project | null;
  }
}

export async function init(): Promise<void> {
  console.log('Magic Potion starting...');

  ctx.project = new Project();
  window.__dawProject = ctx.project;

  // ---- Server (document) --------------------------------------------------
  let jamReassert: (() => void) | null = null;  // set once the jam exists
  let jamIsBroadcasting: (() => boolean) | null = null;
  // AUDIT-5 F1: optional shared server token (context reads it from the
  // #stoken fragment). Absent (dev) = no auth.
  const serverClient = new ServerClient(SERVER_URL, SERVER_TOKEN);
  ctx.serverClient = serverClient;
  serverClient.onConnect = () => {
    els.serverStatus.classList.add('connected');
    // Selection contract: tests read data-state, the class only styles
    els.serverStatus.dataset.state = 'connected';
    // S8b: a listener's JOIN may have died with the old socket
    jamReassert?.();
    console.log('Connected to server');
  };
  serverClient.onDisconnect = () => {
    els.serverStatus.classList.remove('connected');
    els.serverStatus.dataset.state = 'disconnected';
    console.log('Disconnected from server');
  };
  let hasLoadedInitialDoc = false;
  // Anti-entropy cycles still owed after a reconnection (see below)
  let resyncCycles = 0;
  serverClient.onDocument = (data) => {
    // A4-3: first contact and reconnection take the SAME road - MERGE,
    // never replace. The vendored seed gives placeholder and server the
    // same root, so edits made before first contact reconcile instead
    // of being wiped by load().
    const firstContact = !hasLoadedInitialDoc;
    hasLoadedInitialDoc = true;
    if (!firstContact) {
      console.log('Reconnected: merging server document into local state');
    }
    const hadPending = serverClient.pendingCount() > 0;
    // A pristine placeholder (untouched seed, nothing queued) ADOPTS the
    // server document - merging would push the seed root into OLD
    // projects and the tracks LWW could shadow their real content
    // (bitten once, on duo). Offline edits take the merge road.
    if (firstContact && !hadPending && ctx.project!.isPristineSeed()) {
      ctx.project!.load(data);
      renderTracks(true);
      const wantStarter =
        new URLSearchParams(window.location.search).get('starter') === '1';
      if (!LAB_MODE && wantStarter) {
        mountStarter(document.getElementById('starter-slot')!, ctx.project!,
          sendLastChange, () => renderTracks(true));
      }
      return;
    }
    const merged = ctx.project!.mergeRemote(data);
    if (merged === 'error') {
      // A4-2 annex: bad bytes are an ERROR, not "nothing new" - pull
      // a fresh document instead of silently diverging
      serverClient.requestResync(500);
      return;
    }
    // A3-4, the push half of anti-entropy: local novelty the server
    // LACKS (a dead-socket flush, or edits made offline before first
    // contact) goes back up, in causal order, on EVERY document.
    const missing = ctx.project!.getMissingChanges(data);
    if (missing.length > 0) {
      console.log(`Pushing ${missing.length} change(s) the server lacks`);
      for (const change of missing) {
        serverClient.sendChange(change);
      }
    }
    // Whenever an exchange moved anything, demand TWO consecutive
    // no-op exchanges before stopping the verification cycles. On
    // FIRST contact the server's novelty is EXPECTED (its doc is a
    // superset of the placeholder) - only pushes and pending changes
    // are anomalies there, else every page load would triple-connect.
    if ((merged === 'new' && !firstContact) || hadPending || missing.length > 0) {
      resyncCycles = 2;
    } else if (resyncCycles > 0) {
      resyncCycles--;
    }
    if (resyncCycles > 0) {
      serverClient.requestResync();
    }
    if (firstContact) {
      // First contact via the LAUNCHER (?starter=1): offer the starter
      // choice (demo groove / start empty). Gated on the launcher flag so
      // the e2e harness - which drives raw product mechanics on empty
      // product projects - never sees the modal overlay. No-op in lab
      // mode or when the project already has clips.
      const wantStarter =
        new URLSearchParams(window.location.search).get('starter') === '1';
      if (!LAB_MODE && wantStarter) {
        mountStarter(document.getElementById('starter-slot')!, ctx.project!,
          sendLastChange, () => renderTracks(true));
      }
    }
    renderTracks();
  };
  serverClient.onChange = (change) => {
    // A3-5: a change that fails to apply must trigger a resync
    if (!ctx.project!.applyChange(change)) {
      console.warn('Change failed to apply - requesting resync');
      serverClient.requestResync(200);
    }
    renderTracks();
  };

  // ---- Engine (telemetry + transport) -------------------------------------
  // 1pre token resolution: FRAGMENT first (never leaves the browser -
  // logs/Referer safe, the engine-launch path), legacy query second,
  // then the local endpoint (zero-paste: "j'ouvre le site, ca marche").
  const fragTok = new URLSearchParams(
    window.location.hash.replace(/^#/, '')).get('token');
  // Ultra bug_006: scrub the secret from the address bar once read (the
  // OAuth-redirect pattern) - the fragment never hits the network, but
  // it WAS visible on screen, in bookmarks and in copied URLs. Reload
  // recovery is covered by the /api/engine-token path below.
  if (fragTok) history.replaceState(null, '', window.location.pathname + window.location.search);
  const queryTok = new URLSearchParams(window.location.search).get('token');
  const fetchLocalToken = async (): Promise<string | null> => {
    try {
      const r = await fetch(`/api/engine-token?port=${ENGINE_PORT}`);
      if (!r.ok) return null;
      return (await r.json()).token ?? null;
    } catch {
      return null;
    }
  };
  let engineToken = fragTok ?? queryTok ?? '';
  if (!engineToken) engineToken = (await fetchLocalToken()) ?? '';
  const engineClient = new EngineClient({ port: ENGINE_PORT, token: engineToken });
  // 4001 (stale token, e.g. engine restarted) -> re-fetch and retry ONCE,
  // silently - the rule written the day the harness tripped on it.
  engineClient.tokenRefresher = fetchLocalToken;
  ctx.engineClient = engineClient;
  // Sonde de pilotage (doctrine window.__daw*) : permet d'injecter des
  // meters synthetiques pour verifier les VU sans jouer d'audio reel.
  (window as unknown as { __dawEngine?: unknown }).__dawEngine = engineClient;
  // Sonde de pilotage : flush du dernier changement vers le serveur (replique
  // ce que l'UI fait apres chaque mutation - utile aux tests scriptes).
  (window as unknown as { __dawFlush?: unknown }).__dawFlush = sendLastChange;
  // Editor button (per vst3 device, ui/track.ts) -> open/close the plugin
  // GUI window via the engine.
  els.tracks.addEventListener('editor-toggle', (e) => {
    const d = (e as CustomEvent).detail as { procId: string; open: boolean };
    engineClient.setEditor(d.procId, d.open);
  });
  engineClient.onConnect = () => {
    els.engineStatus.classList.add('connected');
    els.engineStatus.dataset.state = 'connected';
    els.playBtn.disabled = ctx.jamListening;   // L1c: listening = suspended
    els.stopBtn.disabled = false;
    els.loopBtn.disabled = false;
    // V1.1: loop is PERFORMANCE state - re-assert the local choice on
    // every (re)connection so an engine restart does not silently drop
    // it. ONLY the explicit ON is asserted: pushing the DEFAULT off
    // meant every fresh tab silently killed the server-mode keepalive
    // loop and the engine died at end-of-song (the night's stealth
    // silence: position frozen at 24.57).
    if (els.loopBtn.getAttribute('aria-pressed') === 'true') {
      engineClient.setLoop(true);
    }
    // S8a: ?tap=1 subscribes to the master tap (the jam road's first
    // meter). Re-asserted per connection like the loop - AND for an
    // active broadcaster: setTap at page load raced the engine socket
    // and vanished (found live: the jam carried a starving worklet's
    // silence, tap:0 in the broadcaster instrumentation).
    if (new URLSearchParams(window.location.search).get('tap') === '1' ||
        jamIsBroadcasting?.()) {
      engineClient.setTap(true);
    }
    console.log('Connected to engine');
  };
  engineClient.onDisconnect = () => {
    els.engineStatus.classList.remove('connected');
    els.engineStatus.dataset.state = 'disconnected';
    els.playBtn.disabled = true;
    els.stopBtn.disabled = true;
    els.loopBtn.disabled = true;
    console.log('Disconnected from engine');
  };

  // V1.4: the "?" button (the help itself must be discoverable)
  (document.getElementById('help-btn') as HTMLButtonElement)
    .addEventListener('click', () => toggleHelp());

  // V1.3: master sweeps coalesce into one undo entry, like track faders
  els.masterGain.addEventListener('pointerdown', () => {
    ctx.project?.beginUndoGroup();
    window.addEventListener('pointerup',
      () => ctx.project?.endUndoGroup(), { once: true });
  });

  // V1.2: master fader -> document (same road as track gains)
  els.masterGain.addEventListener('input', () => {
    if (!ctx.project) return;
    ctx.project.setMasterGain(Number(els.masterGain.value));
    sendLastChange();
    els.masterDb.textContent = formatGain(Number(els.masterGain.value));
  });

  // Session 3 (fraicheur, arbitrage b) : le signal sf du producteur ->
  // badges STEM (frais / perime / inconnu au timeout)
  serverClient.addSignalListener((raw) => {
    const m = raw as { sf?: number; nodes?: Record<string, { f: boolean }> };
    if (m && m.sf === 1 && m.nodes) noteStemFreshness(m.nodes);
  });
  window.setInterval(refreshStemBadges, 2000);

  // L1a: the session clock - every tab measures every peer's clock
  // offset over the signal relay (LINK-DESIGN etage 1). L1b's
  // transport anchors will be translated with these offsets; today it
  // only measures and shows itself.
  const clock = new SessionClock(serverClient);
  (window as any).__dawClock = clock;

  // Multiplayer presence: who is here and what they have selected, over
  // the same signal relay. The roster and the remote-selection flags
  // repaint on every change; renderTracks re-applies the flags after it
  // rebuilds the heads.
  const presence = new Presence(serverClient);
  ctx.presence = presence;
  (window as any).__dawPresence = presence;
  presence.onChange = () => renderPresence(presence);
  renderPresence(presence); // paint the roster (self) immediately
  let clkBadge: HTMLElement | null = null;
  clock.onStateChange = () => {
    const peers = clock.peers();
    if (!clkBadge && peers.size > 0) {
      clkBadge = document.createElement('div');
      clkBadge.className = 'status-item';
      clkBadge.id = 'clk-status';
      clkBadge.title =
        'incertitude de l horloge de session (rtt/2, Link L1a) - ' +
        'l offset brut vit dans __dawClock.snapshot()';
      document.querySelector('.status')?.prepend(clkBadge);
    }
    if (clkBadge) {
      // Critique 2026-08-24 : l'offset brut melange les EPOQUES par
      // onglet (70 s affiches entre deux onglets d'ages differents -
      // correct mais alarmant). Le badge dit l'INCERTITUDE (borne NTP
      // rtt/2) ; l'offset brut reste lisible au snapshot().
      let worst = 0;
      for (const pc of peers.values()) {
        worst = Math.max(worst, pc.rttMs / 2);
      }
      clkBadge.textContent = peers.size === 0 ? 'clk seul'
        : `clk ±${Math.max(1, Math.round(worst))} ms (${peers.size})`;
    }
  };

  // L1b: transport anchors - SYNC is opt-in; PLAY here = PLAY there,
  // anchors translated with the CURRENT clock offset (never frozen).
  const syncBtn = document.getElementById('sync-btn') as HTMLButtonElement;
  const tsync = new TransportSync(serverClient, clock);
  ctx.transportSync = tsync;
  (window as any).__dawSync = tsync;
  tsync.onApply = (playing, posSec) => {
    if (!engineClient.isConnected()) return;
    const sr = ctx.project?.getDocument().sampleRate || 48000;
    if (playing) {
      engineClient.seek(Math.round(posSec * sr));
      engineClient.play();
    } else {
      engineClient.stop();                       // halt first, then park
      engineClient.seek(Math.round(posSec * sr));
    }
    // The remote gesture must be SEEN (rule: every effect announced) -
    // the button flashes when an anchor drives the local transport.
    syncBtn.dataset.flash = '1';
    window.setTimeout(() => { delete syncBtn.dataset.flash; }, 400);
  };
  tsync.onStateChange = () => {
    syncBtn.setAttribute('aria-pressed', tsync.enabled ? 'true' : 'false');
  };
  syncBtn.addEventListener('click', () => tsync.setEnabled(!tsync.enabled));
  if (new URLSearchParams(window.location.search).get('sync') === '1') {
    tsync.setEnabled(true);   // piloting mode, like ?jam= and ?tap=
  }

  // S8b: the jam traversal - one broadcaster per project, listeners
  // answer; latency MEASURED over the data channel and displayed.
  const jam = new JamChannel(serverClient);
  const jamAudio = new JamAudio();
  (window as any).__dawJam = jam;
  (window as any).__dawJamAudio = jamAudio;
  // L1c: rejoin answers come from the LIVE engine (never a stored,
  // drift-aged offset); a jam listener's transport is not authoritative.
  tsync.anchorProvider = () =>
    engineClient.isConnected() && engineClient.isPlaying()
      ? { playing: true, posSec: Math.max(0, ctx.lastPlayheadSec) }
      : null;
  tsync.suspendProvider = () => jam.role === 'listening';
  tsync.stateProvider = () => ({
    engineConnected: engineClient.isConnected(),
    playing: engineClient.isPlaying(),
    posSec: Math.max(0, ctx.lastPlayheadSec),
  });
  let wasListening = false;
  jamReassert = () => jam.reassert();
  jamIsBroadcasting = () => jam.role === 'broadcasting';
  const jamBtn = document.getElementById('jam-btn') as HTMLButtonElement;
  // The badge is PERMANENT (index.html): "jam off" is a state, not an
  // absence - the user should never wonder whether the feature exists.
  const jamBadge = document.getElementById('jam-status') as HTMLElement;
  const renderJamBadge = () => {
    // L1c arbitration (decided 2026-08-24): entering jam listening
    // SUSPENDS the local transport - engine stopped once, PLAY gated,
    // and the badge SAYS it (every effect announced).
    const listening = jam.role === 'listening';
    if (listening && !wasListening && engineClient.isConnected()) {
      engineClient.stop();
    }
    wasListening = listening;
    ctx.jamListening = listening;
    els.playBtn.disabled = listening || !engineClient.isConnected();
    els.playBtn.title = listening
      ? 'Lecture locale suspendue pendant l ecoute du jam (L1c)'
      : 'Play (Space)';
    const peers = jam.peerCount();
    const lat = [...jam.latencyMs.values()];
    jamBadge.dataset.state = peers > 0 ? 'connected' : jam.role;
    const audio = jamAudio.playbackState === 'playing' ? ' ▶' : '';
    jamBadge.textContent = jam.role === 'idle' ? 'jam off'
      : `jam ${jam.role === 'broadcasting' ? 'diffuse' : 'ecoute'} ${peers} pair(s)` +
        (lat.length ? ` ${Math.max(...lat)} ms` : '') + audio +
        (listening ? ' · lecture locale suspendue' : '');
    // Blocked autoplay gets a REAL button, not a hint to click anywhere
    if (jamAudio.playbackState === 'blocked') {
      const play = document.createElement('button');
      play.className = 'jam-play-btn';
      play.textContent = '▶';
      play.title = 'Lancer le son du jam (le navigateur attend un clic)';
      play.addEventListener('click', () => jamAudio.resume());
      jamBadge.append(' ', play);
    }
    jamBtn.setAttribute('aria-pressed', jam.role === 'broadcasting' ? 'true' : 'false');
  };
  renderJamBadge();
  jam.onStateChange = renderJamBadge;
  jamAudio.onStateChange = renderJamBadge;
  // S8c: the listener PLAYS what arrives
  jam.onRemoteTrack = (stream) => jamAudio.playRemote(stream);
  // S8c: the broadcaster's outgoing stream (built before offers fly)
  let jamStream: MediaStream | null = null;
  jam.localStreamProvider = () => jamStream;
  const startBroadcastWithAudio = async () => {
    jamStream = await jamAudio.initBroadcast();
    engineClient.setTap(true);   // the tap feeds the worklet
    jam.startBroadcast();
  };
  jamBtn.addEventListener('click', () => {
    if (jam.role === 'broadcasting') {
      jam.stop();
      jamAudio.stop();
    } else {
      if (jam.role === 'listening') { jam.stop(); jamAudio.stop(); }
      void startBroadcastWithAudio();
    }
  });
  {
    const mode = new URLSearchParams(window.location.search).get('jam');
    if (mode === 'broadcast') void startBroadcastWithAudio();
    else if (mode === 'listen') jam.startListen();
  }

  // S8a: the tap badge - blocks/s, sequence continuity, drops. The
  // meter that says "the jam road's first leg is flowing".
  let tapBlocks = 0;
  let tapNextSeq = -1;
  let tapGaps = 0;
  let tapBadge: HTMLElement | null = null;
  engineClient.onAudioTap = (firstSeq, blockCount, samples, dropped) => {
    if (tapNextSeq >= 0 && firstSeq !== tapNextSeq) tapGaps++;
    tapNextSeq = firstSeq + blockCount;
    tapBlocks += blockCount;
    // S8c: when broadcasting, the tap IS the outgoing jam audio
    if (jam.role === 'broadcasting') jamAudio.feed(samples, blockCount);
    if (!tapBadge) {
      tapBadge = document.createElement('div');
      tapBadge.className = 'status-item';
      tapBadge.id = 'tap-status';
      tapBadge.dataset.state = 'active';
      document.querySelector('.status')?.prepend(tapBadge);
    }
    (window as any).__dawTap = { blocks: tapBlocks, gaps: tapGaps, dropped };
  };
  window.setInterval(() => {
    if (tapBadge) {
      tapBadge.textContent =
        `tap ${tapBlocks * 256 / 48000 | 0}s ${tapGaps === 0 ? 'continu' : tapGaps + ' trous'}`;
    }
  }, 1000);

  // V1.1: loop toggle - local performance state, pushed to the engine
  els.loopBtn.addEventListener('click', () => {
    const on = els.loopBtn.getAttribute('aria-pressed') !== 'true';
    els.loopBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    engineClient.setLoop(on);
  });
  engineClient.onPosition = (samples, sampleRate) => {
    els.position.textContent = formatTime(samples, sampleRate);
    ctx.lastPlayheadSec = samples / sampleRate;
    life.setPosition(ctx.lastPlayheadSec, engineClient.isPlaying());
    refreshOverview();
    // Playhead on the shared scale, PARKED at the lane's end when the
    // engine plays past the content.
    const playhead = document.getElementById('playhead');
    if (playhead) {
      const lane = document.querySelector('.track-lane') as HTMLElement | null;
      const laneW = lane ? lane.offsetWidth : Infinity;
      const x = (samples / sampleRate) * TIMELINE.pps;
      playhead.style.left = `${TIMELINE.headWidth + Math.min(x, laneW)}px`;

      // Follow: keep the playhead in the comfort zone while playing
      if (ctx.follow && !ctx.followPaused && engineClient.isPlaying()) {
        const viewW = els.tracks.clientWidth;
        const headX =
          TIMELINE.headWidth + Math.min(x, laneW) - els.tracks.scrollLeft;
        if (headX > viewW * 0.7 || headX < TIMELINE.headWidth) {
          ctx.programmaticScroll = true;
          els.tracks.scrollLeft = Math.max(0,
            TIMELINE.headWidth + Math.min(x, laneW) - viewW * 0.3);
        }
      }
    }
  };
  // The life layer eats the telemetry - raw values never hit the DOM
  engineClient.onMeters = (meters, masterLeft, masterRight) => {
    life.setTrackLevels(meters.map(({ trackId, peakLeft, peakRight }) =>
      ({ trackId, peak: Math.max(peakLeft, peakRight) })));
    // V1.2: master VU - direct mutation (30 Hz, two bars, no layout).
    // Red above -1 dBFS (~0.891 linear): the ear's line, now VISIBLE.
    const CLIP = 0.8913;
    els.masterVuL.style.width = `${Math.min(100, masterLeft * 100)}%`;
    els.masterVuR.style.width = `${Math.min(100, masterRight * 100)}%`;
    els.masterVuL.classList.toggle('clipping', masterLeft > CLIP);
    els.masterVuR.classList.toggle('clipping', masterRight > CLIP);
    // F3 : la tranche MASTER de la console mixage (les meters par piste ne
    // portent pas le master - le moteur l'emet separement, ici).
    const mm = document.querySelector<HTMLElement>('.mx-vu[data-track-id="__master__"]');
    if (mm) {
      const bl = mm.children[0] as HTMLElement | undefined;
      const br = mm.children[1] as HTMLElement | undefined;
      if (bl) {
        bl.style.height = `${Math.min(100, masterLeft * 100)}%`;
        bl.classList.toggle('clipping', masterLeft > CLIP);
      }
      if (br) {
        br.style.height = `${Math.min(100, masterRight * 100)}%`;
        br.classList.toggle('clipping', masterRight > CLIP);
      }
    }
    // T3 : VU inter-device. Les entrees dont l'id est un proc id (pas une
    // piste) alimentent le mini-VU apres chaque device de la chaine.
    for (const m of meters) {
      const cover = document.querySelector<HTMLElement>(
        `.device-vu[data-proc-id="${m.trackId}"] > i`);
      if (cover) {
        const pk = Math.min(100, Math.max(m.peakLeft, m.peakRight) * 100);
        // Le cache descend du haut ; ce qui reste (le degrade) = le niveau.
        cover.style.height = `${100 - pk}%`;
      }
      // T8 : VU de la console mixage (2 barres L/R par piste).
      const mvu = document.querySelector<HTMLElement>(
        `.mx-vu[data-track-id="${m.trackId}"]`);
      if (mvu) {
        const bl = mvu.children[0] as HTMLElement | undefined;
        const br = mvu.children[1] as HTMLElement | undefined;
        if (bl) {
          bl.style.height = `${Math.min(100, m.peakLeft * 100)}%`;
          bl.classList.toggle('clipping', m.peakLeft > CLIP);
        }
        if (br) {
          br.style.height = `${Math.min(100, m.peakRight * 100)}%`;
          br.classList.toggle('clipping', m.peakRight > CLIP);
        }
      }
    }
  };
  engineClient.onState = (state) => {
    life.setEngineState(state.pluginBlocksMissed);
  };
  // 2.5-decouverte : le catalogue arrive une fois a l'auth - le menu
  // + device le lit a chaque ouverture
  engineClient.onPluginCatalog = (entries) => {
    setPluginCatalog(entries);
    (window as any).__dawPlugins = entries;
    console.log(`Plugin catalog: ${entries.length} classe(s)`);
    renderBrowser();  // T4 : le rail se peuple quand le catalogue arrive
  };
  renderBrowser();  // T4 : etat initial (vide, "scan…") des le montage
  initParadigm();   // T6 : le commutateur Arrangement/Session/Mixage
  initSplitters();  // F7 : colonnes redimensionnables (largeurs persistees)

  // ---- Transport controls -------------------------------------------------
  els.playBtn.addEventListener('click', startPlayback);
  els.stopBtn.addEventListener('click', stopPlayback);

  const followBtn = document.getElementById('follow-btn') as HTMLButtonElement;
  followBtn.setAttribute('aria-pressed', 'true');
  followBtn.addEventListener('click', () => {
    ctx.follow = !ctx.follow;
    ctx.followPaused = false;
    followBtn.setAttribute('aria-pressed', ctx.follow ? 'true' : 'false');
    updateFollowUI();
  });

  // ---- Library / palette --------------------------------------------------
  if (LAB_MODE) {
    const kit = await loadKit();
    if (kit) {
      ctx.library = new Library(kit);
      document.getElementById('library-slot')!.appendChild(ctx.library.element);
    }
  }

  // ---- Drag & drop a WAV on a lane ---------------------------------------
  els.tracks.addEventListener('dragover', (e) => {
    const lane = (e.target as HTMLElement).closest('.track-lane') as HTMLElement | null;
    if (!lane) return;
    e.preventDefault();
    lane.classList.add('dropover');
  });
  els.tracks.addEventListener('dragleave', (e) => {
    const lane = (e.target as HTMLElement).closest('.track-lane') as HTMLElement | null;
    lane?.classList.remove('dropover');
  });
  els.tracks.addEventListener('drop', (e) => {
    const lane = (e.target as HTMLElement).closest('.track-lane') as HTMLElement | null;
    if (!lane) return;
    e.preventDefault();
    lane.classList.remove('dropover');
    const trackEl = lane.closest('[data-track-id]') as HTMLElement | null;
    const trackId = trackEl?.getAttribute('data-track-id');
    const file = e.dataTransfer?.files?.[0];
    if (!trackId || !file) return;
    const x = e.clientX - lane.getBoundingClientRect().left;
    void handleFileDrop(file, trackId, x);
  });

  // ---- Overview (potion A2) ----------------------------------------------
  ctx.overview = new Overview({
    onScrollTo: (sec) => {
      ctx.followPaused = true;
    updateFollowUI();
      ctx.programmaticScroll = true;
      els.tracks.scrollLeft = Math.max(0,
        sec * TIMELINE.pps - (els.tracks.clientWidth - TIMELINE.headWidth) / 2);
      refreshOverview();
    },
    onZoom: (factor, anchorSec) => {
      const rect = els.tracks.getBoundingClientRect();
      setZoom(TIMELINE.pps * factor, anchorSec,
        TIMELINE.headWidth + (rect.width - TIMELINE.headWidth) / 2);
    },
    onFit: fitAll,
  });
  document.getElementById('overview-slot')!.appendChild(ctx.overview.element);

  // ---- Pointer gestures on the timeline ----------------------------------
  els.tracks.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    const fade = target.closest('[data-role="fade-handle"]') as HTMLElement | null;
    if (fade) {
      beginFadeDrag(e, fade);
      return;
    }
    const edge = target.closest('[data-role="clip-edge"]') as HTMLElement | null;
    if (edge) {
      beginClipResize(e, edge);
      return;
    }
    const handle = target.closest('[data-role="clip-handle"]') as HTMLElement | null;
    if (handle) beginClipDrag(e, handle);
  });

  els.tracks.addEventListener('click', (e) => {
    if (ctx.justDragged) return;   // the pointerup already did the work
    const target = e.target as HTMLElement;
    const seekBand = target.closest('[data-role="seek"]') as HTMLElement | null;
    if (seekBand) {
      const x = e.clientX - seekBand.getBoundingClientRect().left;
      const sr = ctx.project?.getDocument().sampleRate || 48000;
      engineClient.seek(Math.round(Math.max(0, x / TIMELINE.pps) * sr));
      return;
    }
    const trackEl = target.closest('[data-track-id]') as HTMLElement | null;
    if (!trackEl) return;
    const id = trackEl.getAttribute('data-track-id');
    if (!id || !ctx.project) return;

    const armed = ctx.library?.getArmed() ?? null;
    const lane = target.closest('.track-lane') as HTMLElement | null;
    if (armed && lane) {
      // Place the armed sample, snapped to a 0.25 s grid
      const sr = ctx.project.getDocument().sampleRate || 48000;
      const x = e.clientX - lane.getBoundingClientRect().left;
      const seconds = Math.max(0, Math.round((x / TIMELINE.pps) / 0.25) * 0.25);
      const placedId = `clip-${armed.name}-${Date.now()}`;
      ctx.project.addClip(id, {
        id: placedId,
        assetHash: armed.hash,
        startSample: Math.round(seconds * sr),
        lengthSamples: Math.round(armed.seconds * sr),
        offsetSamples: 0,
      });
      sendLastChange();
      renderTracks();
      markLanded(placedId);
      return;
    }
    // Lane click (unarmed): select the track AND set the insert marker
    // (Ableton: one click, two effects). Deselects any selected clip.
    const hadSelectedClip = ctx.selectedClipId !== null;
    ctx.selectedClipId = null;
    if (lane) {
      const x = e.clientX - lane.getBoundingClientRect().left;
      ctx.insertMarkerSec =
        Math.max(0, Math.round((x / TIMELINE.pps) / 0.25) * 0.25);
      updateInsertMarker();
      ctx.followPaused = true;   // editing intent: stop chasing
      updateFollowUI();
      // V1.4: announce the marker the click just set (2nd silent effect)
      const markerEl = document.getElementById('insert-marker');
      if (markerEl) {
        markerEl.classList.remove('flash');
        void markerEl.offsetWidth;
        markerEl.classList.add('flash');
      }
    }
    if (id !== ctx.selectedTrackId) {
      ctx.selectedTrackId = id;
      renderTracks(true);
    } else if (hadSelectedClip) {
      // Session B fix: same track, but a clip WAS selected - without
      // this re-render its aria-selected stayed on screen (lying
      // visual, Delete inert) - AUDIT-4 A4-18.
      renderTracks(true);
    }
  });

  // ---- Keyboard -----------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';

    // V1.4: the "?" panel - BEFORE the focus guard (Escape must close
    // from anywhere, including with a button focused; found by spec).
    if (e.key === 'Escape' && isHelpOpen()) {
      toggleHelp(false);
      return;
    }
    if (e.key === '?' && !typing) {
      e.preventDefault();
      toggleHelp();
      return;
    }

    if (typing || tag === 'BUTTON') return;

    // V1.3: undo/redo FIRST - and before the zoom branch below, whose
    // bare KeyZ test used to swallow Ctrl+Z into a zoom (ultra-found bug).
    if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      if (ctx.project?.undo(sendLastChange)) renderTracks(true);
      return;
    }
    if ((e.code === 'KeyY' && (e.ctrlKey || e.metaKey)) ||
        (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
      e.preventDefault();
      if (ctx.project?.redo(sendLastChange)) renderTracks(true);
      return;
    }
    // Delete: remove the selected clip; selection CLEARED (Ableton)
    if ((e.code === 'Delete' || e.code === 'Backspace') &&
        ctx.selectedClipId && ctx.project) {
      e.preventDefault();
      const doc = ctx.project.getDocument();
      const track = doc.tracks.find((t) =>
        t.clips.some((c) => c.id === ctx.selectedClipId));
      if (track) {
        ctx.project.deleteClip(track.id, ctx.selectedClipId!);
        sendLastChange();
        ctx.selectedClipId = null;
        renderTracks(true);
      }
      return;
    }
    // Ctrl+D: duplicate onto the next grid slot, selection on the COPY
    if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey) &&
        ctx.selectedClipId && ctx.project) {
      e.preventDefault();
      const doc = ctx.project.getDocument();
      const sr = doc.sampleRate || 48000;
      const track = doc.tracks.find((t) =>
        t.clips.some((c) => c.id === ctx.selectedClipId));
      const clip = track?.clips.find((c) => c.id === ctx.selectedClipId);
      if (track && clip) {
        const grid = snapStep() * sr;
        const start =
          Math.ceil((clip.startSample + clip.lengthSamples) / grid) * grid;
        const name = clip.id.replace(/^clip-/, '').replace(/-\d+$/, '');
        const copyId = `clip-${name}-${Date.now()}`;
        ctx.project.addClip(track.id, {
          id: copyId,
          assetHash: clip.assetHash,
          startSample: Math.round(start),
          lengthSamples: clip.lengthSamples,
          offsetSamples: clip.offsetSamples,
        });
        sendLastChange();
        ctx.selectedClipId = copyId;
        renderTracks(true);
      }
      return;
    }
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      if (!engineClient.isConnected()) return;
      if (engineClient.isPlaying()) stopPlayback();
      else startPlayback();
      return;
    }
    const rect = els.tracks.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerSec = Math.max(0,
      (els.tracks.scrollLeft + rect.width / 2 - TIMELINE.headWidth) / TIMELINE.pps);
    if (e.key === '+' || e.key === '=') {
      setZoom(TIMELINE.pps * 1.25, centerSec, centerX - rect.left);
    } else if (e.key === '-') {
      setZoom(TIMELINE.pps / 1.25, centerSec, centerX - rect.left);
    } else if (e.code === 'KeyW') {
      fitAll();
    } else if (e.code === 'KeyH') {
      document.body.classList.toggle('compact-tracks');
    } else if (e.code === 'KeyZ' && !e.ctrlKey && !e.metaKey) {
      // Zoom to the marker's neighborhood; X pops back (Ableton Z/X).
      // Modifier guard: without it, Ctrl+Z zoomed (ultra bug, fixed V1.3).
      ctx.zoomStack.push({ pps: TIMELINE.pps, scrollLeft: els.tracks.scrollLeft });
      const windowSec = 8;
      const pps = (rect.width - TIMELINE.headWidth) / windowSec;
      setZoom(pps, Math.max(0, ctx.insertMarkerSec - windowSec / 2),
        TIMELINE.headWidth);
    } else if (e.code === 'KeyX') {
      const prev = ctx.zoomStack.pop();
      if (prev) {
        TIMELINE.pps = prev.pps;
        renderTracks(true);
        ctx.programmaticScroll = true;
        els.tracks.scrollLeft = prev.scrollLeft;
        refreshOverview();
      }
    }
  });

  // Ctrl+wheel = zoom around the cursor; plain wheel pauses Follow
  els.tracks.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) {
      ctx.followPaused = true;
    updateFollowUI();
      return;
    }
    e.preventDefault();
    const rect = els.tracks.getBoundingClientRect();
    const viewportX = e.clientX - rect.left;
    const anchorSec = Math.max(0,
      (els.tracks.scrollLeft + viewportX - TIMELINE.headWidth) / TIMELINE.pps);
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    setZoom(TIMELINE.pps * factor, anchorSec, viewportX);
  }, { passive: false });

  els.tracks.addEventListener('scroll', () => {
    refreshOverview();
    if (ctx.programmaticScroll) {
      ctx.programmaticScroll = false;
      return;
    }
    ctx.followPaused = true;
    updateFollowUI();
  });

  // ---- Phase 3: the touch prototypes (user arbitrates, never the agent) ---
  for (const btn of document.querySelectorAll<HTMLButtonElement>(
    '[data-role="touch-mode"]')) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode!;
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      document.body.classList.toggle(`mode-${mode}`, on);
      if (mode === 'c' && !on) document.body.classList.remove('life-clipping');
      renderTracks(true);
    });
  }

  els.addTrackBtn.addEventListener('click', () => {
    if (!ctx.project) return;
    const trackCount = ctx.project.getDocument().tracks.length;
    ctx.project.addTrack({
      id: `track-${Date.now()}`,
      name: `Track ${trackCount + 1}`,
      gain: 1.0,
      clips: [],
      chain: [],
    });
    sendLastChange();
    renderTracks();
  });

  void contentSeconds;  // (exported for future callers; silence TS 6133)

  // A4-3: draw the seed placeholder BEFORE connecting - a server-less
  // start must be an editable project, not a blank page (offline edits
  // merge on first contact thanks to the shared seed root).
  renderTracks(true);

  // ---- Connect ------------------------------------------------------------
  try {
    await serverClient.connect(PROJECT_ID);
  } catch (e) {
    console.error('Failed to connect to server:', e);
  }
  try {
    await engineClient.connect();
  } catch (e) {
    console.error('Failed to connect to engine:', e);
  }
}
