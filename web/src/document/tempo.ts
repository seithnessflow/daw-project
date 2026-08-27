// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * LE NOYAU TEMPO (migration T1, 2026-08-27) — moitie TypeScript du
 * MIROIR EXACT avec engine/src/graph/tempo.h. Toute divergence casserait
 * le determinisme inter-pairs : les deux implementations sont verifiees
 * par LES MEMES vecteurs d'or (fixtures/tempo-vectors.json).
 *
 * ARITHMETIQUE 100 % ENTIERE (BigInt ici, int64 en C++) — pas de
 * doubles, pas de FMA, pas de libm : bit-identique PAR CONSTRUCTION.
 * Le noyau tourne par geste/rebuild, jamais par frame audio : le cout
 * BigInt est sans objet.
 *
 * Unites :
 * - tick : position musicale, PPQ 960 par noire (2^6*3*5 : doubles-
 *   croches exactes, triolets, quintolets ; convention SMF).
 * - milliBpm : tempo en milli-BPM int (120000 = 120 BPM), bornes
 *   20000..999000 (la plage de Live).
 * - la carte de tempo est PIECEWISE-CONSTANT (le tempo saute au
 *   breakpoint et tient) : l'integration est exacte en entiers ; les
 *   rampes (courbes) viendront en champ additif avec leur propre spec.
 *
 * Sens canonique : ticks -> samples (samplesAtTick). L'inverse
 * (tickAtSample) est UI-only (position de pointeur, regle) et
 * round-trip a un demi-tick pres ; il ne sert JAMAIS a persister une
 * position musicale derivee d'une verite en samples.
 *
 * Arrondi canonique unique : roundDiv = half-up sur domaine positif.
 * L'integration passe par une TABLE DE FRONTIERES : l'arrondi se
 * produit UNE fois par segment + une fois pour la queue — deux pairs
 * calculent le meme int64, l'erreur est bornee a 0,5 sample par
 * breakpoint (identique chez tous les pairs : jamais un risque de
 * determinisme, une note d'exactitude).
 */

export const PPQ = 960n;
export const TICKS_PER_BEAT = 960;  // miroir Number pour l'UI

export const MIN_MILLI_BPM = 20000;
export const MAX_MILLI_BPM = 999000;

export interface TempoPoint {
  tick: number;      // int64 (Number sur <2^53, garde overflow ci-dessous)
  milliBpm: number;  // int, borne 20000..999000
}

/** Garde d'overflow : au-dela, on refuse (C++ garde LA MEME borne -
 *  dt*sr*125*2 doit tenir dans int64 jusqu'a sr=192k).
 *  2^36 ticks ~ 414 jours de timeline a 120 BPM. */
const MAX_TICK = 2n ** 36n;

/** Division entiere arrondie half-up, domaine positif. LA definition. */
export function roundDiv(num: bigint, den: bigint): bigint {
  if (num < 0n || den <= 0n) throw new Error('roundDiv: domaine positif');
  return (2n * num + den) / (2n * den);
}

/**
 * Samples d'un intervalle de dt ticks a tempo constant :
 * dt * sr * 60000 / (960 * milliBpm), reduit par 480 :
 * = roundDiv(dt * sr * 125, 2 * milliBpm).
 * Exemple : dt=960 (1 noire), sr=48000, 120000 mBPM -> 24000 exactement.
 */
export function segSamples(dtTicks: bigint, sampleRate: number,
  milliBpm: number): bigint {
  return roundDiv(dtTicks * BigInt(sampleRate) * 125n,
    2n * BigInt(milliBpm));
}

/**
 * Carte effective : la tempoMap si non vide (avec un breakpoint
 * implicite a 0 au registre si elle ne commence pas a 0), sinon le
 * registre seul. Entree TRIEE par tick (le document la garde triee).
 */
export function effectiveMap(tempoMilliBpm: number,
  tempoMap: readonly TempoPoint[]): TempoPoint[] {
  const reg = clampMilliBpm(tempoMilliBpm);
  if (!tempoMap.length) return [{ tick: 0, milliBpm: reg }];
  const map = tempoMap.map((p) => ({ tick: p.tick,
    milliBpm: clampMilliBpm(p.milliBpm) }));
  if (map[0].tick !== 0) map.unshift({ tick: 0, milliBpm: reg });
  return map;
}

export function clampMilliBpm(v: number): number {
  return Math.max(MIN_MILLI_BPM, Math.min(MAX_MILLI_BPM, Math.round(v)));
}

/**
 * TABLE DE FRONTIERES : S[j] = samples cumules au breakpoint j.
 * C'est LA spec (pas une optimisation) : l'arrondi a lieu une fois par
 * segment, tous les pairs obtiennent la meme table.
 */
export function buildBoundaryTable(map: readonly TempoPoint[],
  sampleRate: number): bigint[] {
  const S: bigint[] = [0n];
  for (let j = 1; j < map.length; j++) {
    const dt = BigInt(map[j].tick - map[j - 1].tick);
    S.push(S[j - 1] + segSamples(dt, sampleRate, map[j - 1].milliBpm));
  }
  return S;
}

/** Position sample CANONIQUE d'un tick (le sens qui fait foi).
 *  Fonction TOTALE : l'entree est clampee a [0, MAX_TICK] - le miroir
 *  C++ clampe IDENTIQUEMENT (jamais une exception d'un seul cote). */
export function samplesAtTick(map: readonly TempoPoint[], S: readonly bigint[],
  sampleRate: number, tick: number): number {
  let t = BigInt(Math.max(0, Math.round(tick)));
  if (t > MAX_TICK) t = MAX_TICK;
  let j = 0;
  while (j + 1 < map.length && BigInt(map[j + 1].tick) <= t) j++;
  const out = S[j] + segSamples(t - BigInt(map[j].tick), sampleRate,
    map[j].milliBpm);
  return Number(out);  // < 2^53 garanti par MAX_TICK (2^36 * sr/tick)
}

/**
 * Inverse UI-only : le tick au sample donne (pointeur, regle).
 * Round-trip a un demi-tick pres ; jamais une source de persistance.
 */
export function tickAtSample(map: readonly TempoPoint[], S: readonly bigint[],
  sampleRate: number, sample: number): number {
  const s = BigInt(Math.max(0, Math.round(sample)));
  let j = 0;
  while (j + 1 < S.length && S[j + 1] <= s) j++;
  let out = BigInt(map[j].tick) +
    roundDiv((s - S[j]) * 2n * BigInt(map[j].milliBpm),
      BigInt(sampleRate) * 125n);
  if (out > MAX_TICK) out = MAX_TICK;  // clamp, miroir du C++
  return Number(out);
}
