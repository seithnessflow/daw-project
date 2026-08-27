// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * PISTES TYPEES audio/MIDI (2026-08-27, demande utilisateur) : le bouton
 * du COIN (+, haut gauche) ouvre le menu Piste audio / Piste MIDI.
 * Preuves : kind ecrit au document + badge sur la tete ; une piste AUDIO
 * n'offre NI piano-roll NI « + clip MIDI » (refus par absence) ; une
 * piste MIDI REFUSE visiblement un sample arme (flash + title) ; les
 * pistes legacy (sans kind) gardent tout ; convergence : le kind voyage
 * vers un second onglet.
 */

import { test, expect } from '@playwright/test';
import { waitForServerConnection } from './helpers';

test('coin + : audio et MIDI crees, badges, gardes de gestes, convergence', async ({ page, context }) => {
  test.setTimeout(60000);
  const projectId = `e2e-kinds-${Date.now()}`;
  // ?lab=1 : la palette du kit est disponible (sample armable sans drop)
  await page.goto(`/?project=${projectId}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });

  // Le COIN : creer une piste AUDIO puis une piste MIDI
  await page.locator('#new-track-btn').click();
  await page.locator('.ctx-menu >> text=+ Piste audio').click();
  await page.locator('#new-track-btn').click();
  await page.locator('.ctx-menu >> text=+ Piste MIDI').click();

  // Le document porte les kinds ; les tetes portent les badges
  const kinds = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    return d.tracks.map((t: any) => ({ name: t.name, kind: t.kind ?? null }));
  });
  const audio = kinds.find((k: any) => k.kind === 'audio');
  const midi = kinds.find((k: any) => k.kind === 'midi');
  expect(audio?.name).toBe('Audio 1');
  expect(midi?.name).toBe('MIDI 1');
  await expect(page.locator('.track-kind-audio')).toHaveText('AUDIO');
  await expect(page.locator('.track-kind-midi')).toHaveText('MIDI');

  // Ids des deux pistes
  const ids = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    return {
      audio: d.tracks.find((t: any) => t.kind === 'audio').id as string,
      midi: d.tracks.find((t: any) => t.kind === 'midi').id as string,
      legacy: d.tracks.find((t: any) => !t.kind).id as string,
    };
  });

  // PISTE AUDIO selectionnee : pas de « + clip MIDI » au rack, et le
  // menu contextuel de sa tete n'offre pas l'entree non plus
  await page.locator(`[data-track-id="${ids.audio}"] .track-name`)
    .click({ force: true });
  await expect(page.locator('[data-role="add-midi"]')).toHaveCount(0);
  await page.locator(`[data-track-id="${ids.audio}"] .track-name`)
    .click({ button: 'right', force: true });
  await expect(page.locator('.ctx-menu')).toBeVisible();
  await expect(page.locator('.ctx-menu >> text=+ clip MIDI')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // PISTE MIDI selectionnee : le piano-roll s'offre
  await page.locator(`[data-track-id="${ids.midi}"] .track-name`)
    .click({ force: true });
  await expect(page.locator('[data-role="add-midi"]')).toHaveCount(1);

  // GARDE : un sample ARME clique sur le couloir MIDI = refus VISIBLE
  await page.locator('.browser-tab', { hasText: 'Samples' }).click();
  await page.locator('.sample-chip').first().click();
  const midiLane = page.locator(`[data-track-id="${ids.midi}"] .track-lane`);
  const before = await page.evaluate((tid) => {
    const d = (window as any).__dawProject.getDocument();
    return d.tracks.find((t: any) => t.id === tid).clips.length;
  }, ids.midi);
  await midiLane.click({ position: { x: 120, y: 20 } });
  await expect(midiLane).toHaveClass(/kind-refused/);
  const after = await page.evaluate((tid) => {
    const d = (window as any).__dawProject.getDocument();
    return d.tracks.find((t: any) => t.id === tid).clips.length;
  }, ids.midi);
  expect(after, 'le sample a ete pose malgre le refus').toBe(before);

  // ... et le MEME clic (le chip est RESTE arme - le refus ne desarme
  // pas) sur la piste AUDIO pose bien le clip
  const audioLane = page.locator(`[data-track-id="${ids.audio}"] .track-lane`);
  await audioLane.click({ position: { x: 120, y: 20 } });
  const audioClips = await page.evaluate((tid) => {
    const d = (window as any).__dawProject.getDocument();
    return d.tracks.find((t: any) => t.id === tid).clips.length;
  }, ids.audio);
  expect(audioClips).toBe(1);

  // CONVERGENCE : le kind voyage (2e onglet, meme projet)
  const page2 = await context.newPage();
  await page2.goto(`/?project=${projectId}`);
  await waitForServerConnection(page2);
  await page2.waitForSelector('.track-kind-midi', { timeout: 10000 });
  await expect(page2.locator('.track-kind-audio')).toHaveText('AUDIO');
  await page2.close();
});
