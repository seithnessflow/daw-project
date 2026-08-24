// SPDX-License-Identifier: GPL-3.0-or-later
// The EAR, end to end (session outillage 2026-08-22): render the CURRENT
// document state to a WAV (offline renderer - never audible, never the
// audio device), then run the analyzer as a gate.
//
// SELECTIVE LISTENING (debug by module): the snapshot COPY of the document
// can be surgically reduced before rendering - the server's document is
// never touched. Every isolation is exact (tracks removed, bypass set in
// the copy), not approximated by mixing tricks.
//
// Usage: npm run ear [-- options]
//   --project <id>        project document (default 'default')
//   --solo <a,b>          keep ONLY these tracks (id or name, name is
//                         case-insensitive) - listen to modules separately
//   --mute <a,b>          remove these tracks from the render
//   --bypass all|<ids>    force bypass=true on chain nodes (hear the dry
//                         path of a module)
//   --no-bypass all|<ids> force bypass=false (hear a plugin the document
//                         currently bypasses)
//   --out <name>          output WAV name, ear/<name>.wav (default
//                         'current') - lets several variants coexist for
//                         A/B comparison with ear:analyze
//
// Examples:
//   npm run ear -- --solo "Track 1"                 # the AGain track alone
//   npm run ear -- --solo "Track 1" --bypass all --out dry
//   npm run ear -- --solo "Track 1" --no-bypass all --out wet
//
// Exit 1 on a red verdict or a failed render - "ca devrait aller" does
// not exist for eardrums.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Automerge from '@automerge/automerge';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
function argList(name) {
  const v = argValue(name, '');
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
const projectId = argValue('--project', 'default');
const solo = argList('--solo');
const mute = argList('--mute');
const bypassArg = argValue('--bypass', '');
const noBypassArg = argValue('--no-bypass', '');
const outName = argValue('--out', 'current');

const docPath = join(root, 'server', 'projects', `${projectId}.am`);
const engineExe = join(root, 'engine', 'build-msvc', 'daw_engine.exe');
const assetsDir = join(root, 'engine', 'test-assets');
const againUid = '84E8DE5F92554F5396FAE4133C935A18';
// Chemin plat depuis la session 2 (2026-08-25) : bundle SDK desactive,
// le fixture est le FICHIER VST3\again.vst3
const againModule = join('VST3', 'again.vst3'); // relative to build-msvc
// Vrais plugins tiers (2026-08-24) : --vst3 uid=chemin, repetable -
// l'oreille doit savoir ecouter tout module que le projet reference.
const extraModules = [];
for (let i = 0; i < args.length - 1; i++) {
  if (args[i] === '--vst3') extraModules.push(args[i + 1]);
}

const earDir = join(here, '..', 'ear');
mkdirSync(earDir, { recursive: true });
const docCopy = join(earDir, `${projectId}-${outName}.am`);
const outWav = join(earDir, `${outName}.wav`);

if (!existsSync(docPath)) {
  console.error(`ear: no such project document: ${docPath} (server never started?)`);
  process.exit(2);
}
if (!existsSync(engineExe)) {
  console.error(`ear: engine binary missing: ${engineExe} (build it first)`);
  process.exit(2);
}

// ---- Snapshot + surgery ---------------------------------------------------
const matches = (track, sel) =>
  track.id === sel || (track.name ?? '').toLowerCase() === sel.toLowerCase();

const needSurgery = solo.length || mute.length || bypassArg || noBypassArg;
if (!needSurgery) {
  copyFileSync(docPath, docCopy);
} else {
  let doc = Automerge.load(readFileSync(docPath));

  // Loud selector check BEFORE mutating: a typo must fail, not render all
  for (const sel of [...solo, ...mute]) {
    if (!doc.tracks.some((t) => matches(t, sel))) {
      console.error(`ear: no track matches '${sel}' (ids/names: ` +
        doc.tracks.slice(0, 8).map((t) => `${t.id}/${t.name}`).join(', ') + ' ...)');
      process.exit(2);
    }
  }

  doc = Automerge.change(doc, (d) => {
    if (solo.length) {
      for (let i = d.tracks.length - 1; i >= 0; i--) {
        if (!solo.some((sel) => matches(d.tracks[i], sel))) d.tracks.splice(i, 1);
      }
    }
    if (mute.length) {
      for (let i = d.tracks.length - 1; i >= 0; i--) {
        if (mute.some((sel) => matches(d.tracks[i], sel))) d.tracks.splice(i, 1);
      }
    }
    for (const t of d.tracks) {
      for (const p of t.chain ?? []) {
        if (bypassArg === 'all' || argList('--bypass').includes(p.id)) p.bypass = true;
        if (noBypassArg === 'all' || argList('--no-bypass').includes(p.id)) p.bypass = false;
      }
    }
  });

  const kept = doc.tracks.map((t) => t.name || t.id).join(', ');
  console.error(`ear: surgical snapshot - ${doc.tracks.length} track(s) kept [${kept}]` +
    (bypassArg ? ` | bypass forced ON (${bypassArg})` : '') +
    (noBypassArg ? ` | bypass forced OFF (${noBypassArg})` : ''));
  if (doc.tracks.length === 0) {
    console.error('ear: surgery left zero tracks - nothing to render');
    process.exit(2);
  }
  writeFileSync(docCopy, Automerge.save(doc));
}

// ---- Asset staging --------------------------------------------------------
// The STORE is the source of truth for user-dropped assets. Lesson
// 2026-08-23 (seance musique): ear pointed only at engine/test-assets, so
// any project made of real user files rendered 48 s of SILENCE - and the
// gate said green. Resolution order: server store first, test-assets
// fallback (seeded fixtures), missing = LOUD REFUSAL, never silence.
const storeDir = join(root, 'server', 'assets');
const stageDir = join(earDir, 'assets-stage');
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
{
  const stagedDoc = Automerge.load(readFileSync(docCopy));
  const hashes = new Set();
  for (const t of stagedDoc.tracks) for (const c of t.clips ?? []) if (c.assetHash) hashes.add(c.assetHash);
  // Session 3 (2026-08-25) : les blobs de STEMS et d'ETAT sont des
  // assets comme les autres - sans eux, le pair-simule (rendu sans
  // modules) ne peut pas jouer la verite rendue, et l'etat capture
  // n'est pas restaure. Attrape par le quatuor de preuve (rendu SANS
  // = echec faute de stem stage).
  for (const t of stagedDoc.tracks) for (const p of t.chain ?? []) {
    if (p.stemHash) hashes.add(p.stemHash);
    if (p.stateHash) hashes.add(p.stateHash);
  }
  const missing = [];
  for (const h of hashes) {
    const name = `${h}.wav`;
    const src = [join(storeDir, name), join(assetsDir, name)].find(existsSync);
    if (!src) { missing.push(h); continue; }
    copyFileSync(src, join(stageDir, name));
  }
  if (missing.length) {
    console.error(`ear: ${missing.length} asset(s) in the document but NOT FOUND in the store (${storeDir}) nor test-assets - refusing to render silence:`);
    for (const h of missing) console.error(`  ${h}`);
    process.exit(2);
  }
  console.error(`ear: ${hashes.size} asset(s) staged from store/test-assets`);
}

// ---- Render (offline, silent by nature) -----------------------------------
const render = spawnSync(
  engineExe,
  ['--doc', docCopy, '--render', outWav, '--assets', stageDir,
   '--vst3-module', `${againUid}=${againModule}`,
   ...extraModules.flatMap((m) => ['--vst3-module', m])],
  { cwd: join(root, 'engine', 'build-msvc'), encoding: 'utf8', timeout: 120000 },
);
if (render.status !== 0) {
  console.error('ear: RENDER FAILED (loud, as designed):');
  console.error((render.stderr || render.stdout || '').split('\n').slice(-15).join('\n'));
  process.exit(1);
}
// Organe (2026-08-25) : sur succes le journal du rendu etait AVALE -
// impossible de savoir quel chemin chaque noeud a pris (vrai plugin ou
// stem). --verbose le rejoue ; sans lui, les lignes de VERITE DE CHEMIN
// (STEM / out-of-process / unresolved) passent toujours.
{
  const log = (render.stderr || '') + (render.stdout || '');
  const verbose = args.includes('--verbose');
  for (const line of log.split('\n')) {
    if (verbose || /STEM|stem |out-of-process|unresolved|proxy/i.test(line)) {
      console.error('render| ' + line.trim());
    }
  }
}

// ---- Gate -----------------------------------------------------------------
const gate = spawnSync(
  process.execPath,
  [join(here, 'ear-analyze.mjs'), outWav, '--gate'],
  { encoding: 'utf8' },
);
process.stdout.write(gate.stdout);
process.stderr.write(gate.stderr);
process.exit(gate.status ?? 1);
