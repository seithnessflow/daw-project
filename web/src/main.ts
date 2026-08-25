// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Magic Potion — entry point. Everything lives in split modules
 * (CLAUDE.md rule: split au maximum):
 *   styles/   one CSS module per zone (vite hot-injects per file,
 *             no reload, no state loss - the co-presence requirement)
 *   app/      context (state+DOM), navigation, transport, gestures,
 *             placement, render, wiring
 *   ui/       components (track, overview, library, waveform, life)
 *   document/ Automerge wrapper   network/ server+engine clients
 */

// Polices bundlees (offline-safe) - direction "etabli de studio"
import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/topbar.css';
import './styles/browser.css';
import './styles/library.css';
import './styles/overview.css';
import './styles/timeline.css';
import './styles/trackhead.css';
import './styles/devices.css';
import './styles/presence.css';
import './styles/piano-roll.css';
import './styles/session.css';
import './styles/mixer.css';
import './styles/life.css';
import './styles/touch-modes.css';
import './styles/starter.css';
import './styles/help.css';
import './styles/menu.css';

// Menu principal (2026-08-25) : sans ?project= dans l'URL, on affiche le
// selecteur de projets (bookmark stable a la racine) plutot que de booter
// 'default'. Avec ?project=, l'app demarre comme avant. Import dynamique :
// le menu ne tire pas tout le moteur/document.
if (new URLSearchParams(window.location.search).has('project')) {
  void import('./app/wiring').then(({ init }) => init().catch(console.error));
} else {
  void import('./ui/menu').then(({ mountMenu }) => mountMenu(document.body).catch(console.error));
}
