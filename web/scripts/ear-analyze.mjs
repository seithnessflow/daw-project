// SPDX-License-Identifier: GPL-3.0-or-later
// The EAR (session outillage 2026-08-22): compact verdict on a WAV file.
// Pure Node, zero dependency - runs anywhere, including CI on a fixture.
//
// Usage: node ear-analyze.mjs <file.wav> [--gate] [--quiet]
//   --gate   exit 1 when the verdict is red (peak > -1 dBFS, clipped
//            samples, or discontinuities) - the pre-listen safety gate
//   --quiet  print only the JSON (default prints JSON; quiet suppresses
//            the human summary line)
//
// Metrics and their honest limits:
// - true_peak_dbfs: 4x oversampled peak (windowed-sinc interpolation
//   around candidate samples). sample_peak_dbfs is the raw sample max.
// - discontinuities: |x[n]-x[n-1]| > 0.5 per channel, a CLICK heuristic.
//   PERIODIC edges are content, not clicks (hardened 2026-08-22 after a
//   loud square in the lab tripped the gate): when the >0.5 jumps are
//   numerous AND regularly spaced, they are reported as periodic_edges
//   (informative) and do NOT redden the verdict. Honest residual limit:
//   one real click buried among thousands of regular square edges is
//   statistically invisible to this heuristic.
// - rms_dbfs_windows: 100 ms windows, all channels pooled, rounded 0.1 dB.
// - silence_ratio: fraction of windows below -60 dBFS RMS.

import { readFileSync } from 'node:fs';

const DB_FLOOR = -120;

function dbfs(x) {
  if (!(x > 0)) return DB_FLOOR;
  return Math.max(DB_FLOOR, 20 * Math.log10(x));
}

/** Minimal RIFF/WAVE reader: PCM 16/24/32 and float32, any channel count. */
export function readWav(path) {
  const buf = readFileSync(path);
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' ||
      buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: not a RIFF/WAVE file`);
  }
  let pos = 12;
  let fmt = null;
  let dataOff = -1;
  let dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(pos + 8),
        channels: buf.readUInt16LE(pos + 10),
        sampleRate: buf.readUInt32LE(pos + 12),
        bits: buf.readUInt16LE(pos + 22),
      };
    } else if (id === 'data') {
      dataOff = pos + 8;
      dataLen = Math.min(size, buf.length - dataOff);
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmt || dataOff < 0) throw new Error(`${path}: missing fmt/data chunk`);
  const { format, channels, sampleRate, bits } = fmt;
  const bytesPer = bits / 8;
  const frames = Math.floor(dataLen / (bytesPer * channels));
  const ch = Array.from({ length: channels }, () => new Float64Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const o = dataOff + (f * channels + c) * bytesPer;
      let v;
      if (format === 3 && bits === 32) v = buf.readFloatLE(o);
      else if (format === 1 && bits === 16) v = buf.readInt16LE(o) / 32768;
      else if (format === 1 && bits === 24)
        v = ((buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16)) << 8 >> 8) / 8388608;
      else if (format === 1 && bits === 32) v = buf.readInt32LE(o) / 2147483648;
      else throw new Error(`${path}: unsupported format ${format}/${bits}bit`);
      ch[c][f] = v;
    }
  }
  return { sampleRate, channels: ch, frames };
}

/** Windowed-sinc value of channel x at fractional position n+frac. */
function sincAt(x, n, frac) {
  const TAPS = 16; // +-16 samples
  let acc = 0;
  for (let k = -TAPS + 1; k <= TAPS; k++) {
    const idx = n + k;
    if (idx < 0 || idx >= x.length) continue;
    const t = frac - k;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const win = 0.5 + 0.5 * Math.cos((Math.PI * t) / TAPS); // Hann
    acc += x[idx] * sinc * win;
  }
  return acc;
}

export function analyze(wav) {
  const { sampleRate, channels, frames } = wav;
  let samplePeak = 0;
  let clipped = 0;
  let discontinuities = 0;
  let periodicEdges = 0;
  let maxJump = 0;
  let dcMax = 0;

  for (const x of channels) {
    let sum = 0;
    const jumpAt = [];
    for (let n = 0; n < x.length; n++) {
      const a = Math.abs(x[n]);
      if (a > samplePeak) samplePeak = a;
      if (a >= 0.999) clipped++;
      sum += x[n];
      if (n > 0) {
        const j = Math.abs(x[n] - x[n - 1]);
        if (j > maxJump) maxJump = j;
        if (j > 0.5) jumpAt.push([n, j]);
      }
    }
    dcMax = Math.max(dcMax, Math.abs(sum / Math.max(1, x.length)));

    // Periodic edges are content (square/saw at high gain), not clicks:
    // many jumps whose spacing clusters around a fundamental period.
    // MEDIAN-based (outlier-immune): overlapping material can push a few
    // edges under the threshold (double/triple intervals) and silence
    // gaps create one huge interval - neither should reclassify content
    // as clicks. Edges within [0.5, 4] x median are periodic; the REST
    // are the actual click candidates.
    if (jumpAt.length >= 32) {
      const intervals = [];
      for (let i = 1; i < jumpAt.length; i++) {
        intervals.push(jumpAt[i][0] - jumpAt[i - 1][0]);
      }
      const sorted = [...intervals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const irregular = intervals.filter(
        (iv) => iv < median * 0.5 || iv > median * 4).length;
      if (irregular / intervals.length < 0.10) {
        // A periodic field. Its edges share an amplitude scale; a
        // residual is a CLICK only if it clearly exceeds that scale
        // (interval outliers at field amplitude are the field itself,
        // displaced by summation with other material).
        const amps = jumpAt.map(([, j]) => j).sort((a, b) => a - b);
        const ampP50 = amps[Math.floor(amps.length / 2)];
        const clicks = jumpAt.filter(([, j]) => j > ampP50 * 1.5).length;
        periodicEdges += jumpAt.length - clicks;
        discontinuities += clicks;
        continue;
      }
    }
    discontinuities += jumpAt.length;
  }

  // True peak: 4x oversample only around candidates (samples whose
  // neighborhood approaches the sample peak) - exact enough, fast enough.
  let truePeak = samplePeak;
  const threshold = samplePeak * 0.7;
  for (const x of channels) {
    for (let n = 0; n < x.length; n++) {
      if (Math.abs(x[n]) < threshold) continue;
      for (const frac of [0.25, 0.5, 0.75]) {
        const v = Math.abs(sincAt(x, n, frac));
        if (v > truePeak) truePeak = v;
      }
    }
  }

  // 100 ms windows, all channels pooled
  const win = Math.max(1, Math.round(sampleRate / 10));
  const nWin = Math.max(1, Math.floor(frames / win));
  const rmsWindows = [];
  let silent = 0;
  let sumSqTotal = 0;
  for (let w = 0; w < nWin; w++) {
    let sq = 0;
    let count = 0;
    for (const x of channels) {
      for (let n = w * win; n < (w + 1) * win && n < x.length; n++) {
        sq += x[n] * x[n];
        count++;
      }
    }
    sumSqTotal += sq;
    const rms = Math.sqrt(sq / Math.max(1, count));
    const db = dbfs(rms);
    rmsWindows.push(Math.round(db * 10) / 10);
    if (db < -60) silent++;
  }
  const rmsOverall = dbfs(Math.sqrt(sumSqTotal / Math.max(1, frames * channels.length)));

  const truePeakDb = dbfs(truePeak);
  const reasons = [];
  if (truePeakDb > -1) reasons.push(`true peak ${truePeakDb.toFixed(1)} dBFS > -1 dBFS`);
  if (clipped > 0) reasons.push(`${clipped} clipped samples`);
  if (discontinuities > 0) reasons.push(`${discontinuities} discontinuities (max jump ${maxJump.toFixed(3)})`);

  return {
    sample_rate: sampleRate,
    channels: channels.length,
    duration_s: Math.round((frames / sampleRate) * 100) / 100,
    sample_peak_dbfs: Math.round(dbfs(samplePeak) * 100) / 100,
    true_peak_dbfs: Math.round(truePeakDb * 100) / 100,
    rms_dbfs_overall: Math.round(rmsOverall * 100) / 100,
    rms_dbfs_windows: rmsWindows,
    dc_offset: Math.round(dcMax * 1e6) / 1e6,
    discontinuities,
    periodic_edges: periodicEdges,
    max_jump: Math.round(maxJump * 1000) / 1000,
    clipped_samples: clipped,
    silence_ratio: Math.round((silent / nWin) * 1000) / 1000,
    verdict: { ok: reasons.length === 0, reasons },
  };
}

// ---- CLI ------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url.endsWith(
  process.argv[1].split(/[\\/]/).pop());
if (isMain) {
  const args = process.argv.slice(2);
  const gate = args.includes('--gate');
  const quiet = args.includes('--quiet');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: node ear-analyze.mjs <file.wav> [--gate] [--quiet]');
    process.exit(2);
  }
  const result = { file, ...analyze(readWav(file)) };
  console.log(JSON.stringify(result));
  if (!quiet) {
    const v = result.verdict;
    console.error(v.ok
      ? `EAR: green (peak ${result.true_peak_dbfs} dBFS, rms ${result.rms_dbfs_overall} dBFS)`
      : `EAR: RED - ${v.reasons.join('; ')}`);
  }
  if (gate && !result.verdict.ok) process.exit(1);
}
