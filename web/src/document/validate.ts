// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * VALIDATION DU DOCUMENT (A4-8, decision utilisateur 2026-08-29 : « on
 * charge avec un bandeau »). Miroir des regles du moteur
 * (engine/src/document/schema.cpp validateDocument) - JUMEAU VOULU : les
 * deux etages doivent nommer les memes fautes, le moteur dans son log
 * (`WARNING: document invalid (loaded anyway)`), l'onglet dans son
 * bandeau (app/doc_guard.ts). Un document invalide se CHARGE quand meme :
 * on annonce, on ne refuse pas (refuser = perdre le travail d'un pair).
 *
 * Pure : aucune ecriture, aucun DOM. Retourne une liste de fautes lisibles
 * (vide = document sain).
 */
import { SCHEMA_VERSION, type ProjectDef } from './schema';

export function validateDocument(doc: ProjectDef): string[] {
  const errors: string[] = [];
  if (!doc || typeof doc !== 'object') return ['document absent'];
  if (!(doc.schemaVersion >= 1)) errors.push('version de schema < 1');
  if (doc.schemaVersion > SCHEMA_VERSION) {
    errors.push(`version de schema ${doc.schemaVersion} inconnue (max ${SCHEMA_VERSION})`);
  }
  if (!(doc.sampleRate > 0)) errors.push('taux d\'echantillonnage <= 0');
  if (!Array.isArray(doc.tracks)) { errors.push('pas de liste de pistes'); return errors; }

  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  doc.tracks.forEach((t, i) => {
    const label = t.name ? `« ${t.name} »` : `piste ${i + 1}`;
    if (!t.id) errors.push(`${label} : id vide`);
    else if (trackIds.has(t.id)) errors.push(`${label} : id de piste en double (${t.id})`);
    else trackIds.add(t.id);
    if (!(t.gain >= 0 && t.gain <= 2)) errors.push(`${label} : gain ${t.gain} hors [0, 2]`);
    if (t.pan !== undefined && !(t.pan >= -1 && t.pan <= 1)) {
      errors.push(`${label} : pan ${t.pan} hors [-1, 1]`);
    }
    (t.clips ?? []).forEach((c, j) => {
      const cl = `${label} clip ${c.id || j + 1}`;
      if (!c.id) errors.push(`${cl} : id vide`);
      else if (clipIds.has(c.id)) errors.push(`${cl} : id de clip en double`);
      else clipIds.add(c.id);
      const musical = typeof c.startTick === 'number';
      if (musical) {
        if (!(c.startTick! >= 0)) errors.push(`${cl} : tick de depart negatif`);
        if (c.lengthTick !== undefined && !(c.lengthTick > 0)) errors.push(`${cl} : longueur en ticks invalide`);
      } else if (!(typeof c.startSample === 'number' && c.startSample >= 0)) {
        errors.push(`${cl} : position de depart absente ou negative`);
      }
      if (!musical || c.lengthTick === undefined) {
        if (!(typeof c.lengthSamples === 'number' && c.lengthSamples > 0)) {
          errors.push(`${cl} : longueur invalide`);
        }
      }
      if (c.offsetSamples !== undefined && !(c.offsetSamples >= 0)) {
        errors.push(`${cl} : offset negatif`);
      }
    });
    (t.chain ?? []).forEach((p, j) => {
      if (!p.id) errors.push(`${label} device ${j + 1} : id vide`);
      if (!p.type) errors.push(`${label} device ${p.id || j + 1} : type vide`);
    });
  });
  return errors;
}
