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

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const againModule = join('VST3', 'Release', 'again.vst3'); // relative to build-msvc

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

// ---- Render (offline, silent by nature) -----------------------------------
const render = spawnSync(
  engineExe,
  ['--doc', docCopy, '--render', outWav, '--assets', assetsDir,
   '--vst3-module', `${againUid}=${againModule}`],
  { cwd: join(root, 'engine', 'build-msvc'), encoding: 'utf8', timeout: 120000 },
);
if (render.status !== 0) {
  console.error('ear: RENDER FAILED (loud, as designed):');
  console.error((render.stderr || render.stdout || '').split('\n').slice(-15).join('\n'));
  process.exit(1);
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
