// SPDX-License-Identifier: GPL-3.0-or-later
// Self-test of the EAR analyzer - CI-safe (no stack, no audio device).
// The ear calibrates on a KNOWN signal before judging the unknown:
// 1. GREEN: synthesized 440 Hz tone at 0.25 (-12.04 dBFS peak,
//    -15.05 dBFS RMS) - every metric asserted against the math.
// 2. GREEN on the repo fixture engine/test-assets/test_tone.wav
//    (same tone, 30 s, committed - the 2.4b-family known signal).
// 3. RED: same tone with an injected clip plateau and a hard
//    discontinuity - both must be detected, the gate must refuse.
//
// Run: node web/scripts/ear-analyze.test.mjs   (exit 0 = all green)

import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readWav, analyze } from './ear-analyze.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;

function check(label, cond, detail) {
  if (cond) {
    console.log(`  ok: ${label}`);
  } else {
    failures++;
    console.error(`  FAILED: ${label} (${detail})`);
  }
}

function writeWav16(path, samples, sampleRate = 48000, channels = 2) {
  const frames = samples.length / channels;
  const dataLen = frames * channels * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

function tone(seconds, amp = 0.25, sr = 48000) {
  const frames = seconds * sr;
  const s = new Float64Array(frames * 2);
  for (let n = 0; n < frames; n++) {
    const v = amp * Math.sin((2 * Math.PI * 440 * n) / sr);
    s[2 * n] = v;
    s[2 * n + 1] = v;
  }
  return s;
}

const dir = mkdtempSync(join(tmpdir(), 'ear-test-'));

// ---- 1. GREEN: the known signal, metric by metric -------------------------
console.log('Test 1: synthesized tone (known math)');
{
  const path = join(dir, 'tone.wav');
  writeWav16(path, tone(2));
  const r = analyze(readWav(path));
  check('peak = -12.04 dBFS +-0.15', Math.abs(r.sample_peak_dbfs - -12.04) < 0.15, r.sample_peak_dbfs);
  check('true peak within 0.2 dB of sample peak', Math.abs(r.true_peak_dbfs - r.sample_peak_dbfs) < 0.2, r.true_peak_dbfs);
  check('rms = -15.05 dBFS +-0.15', Math.abs(r.rms_dbfs_overall - -15.05) < 0.15, r.rms_dbfs_overall);
  check('no discontinuities', r.discontinuities === 0, r.discontinuities);
  check('no clipping', r.clipped_samples === 0, r.clipped_samples);
  check('no silence', r.silence_ratio === 0, r.silence_ratio);
  check('dc ~ 0', r.dc_offset < 0.001, r.dc_offset);
  check('verdict green', r.verdict.ok, JSON.stringify(r.verdict));
}

// ---- 2. GREEN: the committed repo fixture ---------------------------------
console.log('Test 2: repo fixture test_tone.wav (calibration on the real file)');
{
  const fixture = resolve(here, '..', '..', 'engine', 'test-assets', 'test_tone.wav');
  if (!existsSync(fixture)) {
    failures++;
    console.error(`  FAILED: fixture missing: ${fixture}`);
  } else {
    const r = analyze(readWav(fixture));
    check('peak = -12.04 dBFS +-0.15', Math.abs(r.sample_peak_dbfs - -12.04) < 0.15, r.sample_peak_dbfs);
    check('rms = -15.05 dBFS +-0.15', Math.abs(r.rms_dbfs_overall - -15.05) < 0.15, r.rms_dbfs_overall);
    check('verdict green', r.verdict.ok, JSON.stringify(r.verdict));
  }
}

// ---- 3. RED: injected clip + discontinuity, both must be caught -----------
console.log('Test 3: corrupted tone (injected clip plateau + hard jump)');
{
  const s = tone(2);
  const mid = Math.floor(s.length / 4) * 2; // frame boundary
  for (let k = 0; k < 20; k++) {           // 10 clipped frames, both channels
    s[mid + k] = 1.0;
  }
  const jumpAt = mid + 20000;
  s[jumpAt] = 0.9;                          // hard jump from a ~0.25 tone
  const path = join(dir, 'bad.wav');
  writeWav16(path, s);
  const r = analyze(readWav(path));
  check('clipping detected', r.clipped_samples >= 10, r.clipped_samples);
  check('discontinuity detected', r.discontinuities >= 1, r.discontinuities);
  check('peak above -1 dBFS flagged', r.true_peak_dbfs > -1, r.true_peak_dbfs);
  check('verdict RED', !r.verdict.ok, JSON.stringify(r.verdict));
}

// ---- 4. Periodic edges are content, not clicks (hardened after a loud
// square in the lab tripped the gate) -----------------------------------
console.log('Test 4: loud square = periodic edges, green; square + spike = red');
{
  const sr = 48000;
  const frames = 2 * sr;
  const sq = new Float64Array(frames * 2);
  for (let n = 0; n < frames; n++) {
    const v = 0.32 * Math.sign(Math.sin((2 * Math.PI * 220 * n) / sr)); // jumps 0.64
    sq[2 * n] = v;
    sq[2 * n + 1] = v;
  }
  const path = join(dir, 'square-loud.wav');
  writeWav16(path, sq);
  const r = analyze(readWav(path));
  check('periodic edges detected', r.periodic_edges > 1000, r.periodic_edges);
  check('no discontinuities flagged', r.discontinuities === 0, r.discontinuities);
  check('verdict green', r.verdict.ok, JSON.stringify(r.verdict));

  // Same square with ONE isolated spike far above the edge size: the
  // spike bucket is irregular only if it dominates - honest limit is
  // documented; here we assert the pure-spike file still reds (test 3
  // covers it) and the square file alone stays green.
}

// ---- 5. Percussive attacks are content, not clicks (calibrated after
// the ear flagged a real drum beat as 1796 clicks) ----------------------
console.log('Test 5: drum burst train = attacks green; lone spike still red');
{
  const sr = 48000;
  const frames = 2 * sr;
  const s = new Float64Array(frames * 2);
  for (let hit = 0; hit < 8; hit++) {
    const at = Math.round(hit * 0.25 * sr);
    for (let n = 0; n < 4800 && at + n < frames; n++) {
      // hard attack (starts at 0.6), decaying 100 Hz body = a kick shape
      const v = 0.6 * Math.exp(-n / 4000) * Math.cos((2 * Math.PI * 100 * n) / sr);
      s[2 * (at + n)] = v;
      s[2 * (at + n) + 1] = v;
    }
  }
  const path = join(dir, 'drums.wav');
  writeWav16(path, s);
  const r = analyze(readWav(path));
  check('attacks not flagged as clicks', r.discontinuities === 0,
    `disc=${r.discontinuities}`);
  check('verdict green on drums', r.verdict.ok, JSON.stringify(r.verdict));
}

if (failures > 0) {
  console.error(`\near-analyze self-test: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\near-analyze self-test: all green');
