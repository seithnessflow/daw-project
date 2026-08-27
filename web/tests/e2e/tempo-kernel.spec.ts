// SPDX-License-Identifier: GPL-3.0-or-later
// LE MIROIR, moitie TS : le noyau tempo (web/src/document/tempo.ts)
// verifie sur LES MEMES vecteurs d'or que le gtest C++
// (fixtures/tempo-vectors.json, consomme par cli_integration_test.cpp).
// Pur Node : aucun navigateur, aucune stack — le noyau est du calcul.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  effectiveMap, buildBoundaryTable, samplesAtTick, tickAtSample,
  segSamples, roundDiv, clampMilliBpm, TICKS_PER_BEAT,
} from '../../src/document/tempo';

const here = dirname(fileURLToPath(import.meta.url));
const vectorsPath = join(here, '..', '..', '..', 'fixtures',
  'tempo-vectors.json');

interface VectorCase {
  name: string;
  sampleRate: number;
  registerMilliBpm: number;
  map: number[];            // paires plates [tick, milliBpm, ...]
  ticksToSamples: number[];  // paires plates [tick, attendu, ...]
  samplesToTicks: number[];  // paires plates [sample, attendu, ...]
}

const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8')) as {
  ppq: number; cases: VectorCase[];
};

function pairs(flat: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

test.describe('noyau tempo — vecteurs d\'or partages', () => {
  test('PPQ du fichier = PPQ du noyau', () => {
    expect(vectors.ppq).toBe(TICKS_PER_BEAT);
  });

  for (const c of vectors.cases) {
    test(`vecteurs: ${c.name}`, () => {
      const map = effectiveMap(c.registerMilliBpm,
        pairs(c.map).map(([tick, milliBpm]) => ({ tick, milliBpm })));
      const S = buildBoundaryTable(map, c.sampleRate);
      for (const [tick, want] of pairs(c.ticksToSamples)) {
        expect(samplesAtTick(map, S, c.sampleRate, tick),
          `${c.name}: samplesAtTick(${tick})`).toBe(want);
      }
      for (const [sample, want] of pairs(c.samplesToTicks)) {
        expect(tickAtSample(map, S, c.sampleRate, sample),
          `${c.name}: tickAtSample(${sample})`).toBe(want);
      }
    });
  }

  test('roundDiv est half-up sur le domaine positif', () => {
    expect(roundDiv(1n, 2n)).toBe(1n);   // 0,5 -> 1
    expect(roundDiv(3n, 2n)).toBe(2n);   // 1,5 -> 2
    expect(roundDiv(2n, 3n)).toBe(1n);   // 0,66 -> 1
    expect(roundDiv(1n, 3n)).toBe(0n);   // 0,33 -> 0
    expect(roundDiv(0n, 5n)).toBe(0n);
    expect(() => roundDiv(-1n, 2n)).toThrow();
    expect(() => roundDiv(1n, 0n)).toThrow();
  });

  test('clampMilliBpm borne 20000..999000', () => {
    expect(clampMilliBpm(5000)).toBe(20000);
    expect(clampMilliBpm(1500000)).toBe(999000);
    expect(clampMilliBpm(120000)).toBe(120000);
  });

  test('round-trip tick -> sample -> tick au demi-tick pres', () => {
    const map = effectiveMap(120000, [
      { tick: 0, milliBpm: 120000 },
      { tick: 3840, milliBpm: 87654 },
      { tick: 9999, milliBpm: 543210 },
    ]);
    const S = buildBoundaryTable(map, 48000);
    for (const tick of [0, 1, 959, 3840, 3841, 9998, 9999, 20000, 123456]) {
      const s = samplesAtTick(map, S, 48000, tick);
      const back = tickAtSample(map, S, 48000, s);
      expect(Math.abs(back - tick),
        `round-trip tick=${tick}`).toBeLessThanOrEqual(1);
    }
  });

  test('adjacence sans couture : durees = difference de positions', () => {
    // Deux clips musicaux adjacents (fin de A = debut de B en ticks)
    // se resolvent en samples SANS trou ni chevauchement, par
    // construction : fin(A) et debut(B) sont LE MEME samplesAtTick.
    const map = effectiveMap(100000, []);
    const S = buildBoundaryTable(map, 48000);
    const aStart = samplesAtTick(map, S, 48000, 0);
    const aEnd = samplesAtTick(map, S, 48000, 3840);
    const bStart = samplesAtTick(map, S, 48000, 3840);
    expect(aEnd).toBe(bStart);
    expect(aEnd - aStart).toBe(115200);  // 1 mesure @100 BPM = 2,400 s
  });

  test('segSamples : 1 noire @120/48k = 24000 exactement', () => {
    expect(segSamples(960n, 48000, 120000)).toBe(24000n);
  });
});
