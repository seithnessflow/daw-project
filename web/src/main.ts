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

import './styles/base.css';
import './styles/topbar.css';
import './styles/library.css';
import './styles/overview.css';
import './styles/timeline.css';
import './styles/trackhead.css';
import './styles/devices.css';
import './styles/life.css';
import './styles/touch-modes.css';

import { init } from './app/wiring';

init().catch(console.error);
