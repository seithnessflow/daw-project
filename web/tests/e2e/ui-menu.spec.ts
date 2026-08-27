// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Invariants du menu principal (selecteur de projets a une URL stable).
 * Sans ?project= dans l'URL -> le menu ; ouvrir un projet preserve le fragment
 * (#stoken/#token) ; creer un projet navigue ; les artefacts e2e timestampes
 * sont MASQUES (le store en est plein).
 */
import { test, expect } from '@playwright/test';

const TEST_ARTIFACT = /-\d{10,}$/;

test.describe('Menu principal : selecteur de projets', () => {
  test('la racine affiche le menu et liste des projets (sans les artefacts timestampes)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.menu', { timeout: 10000 });
    // il y a des projets nommes a la main dans le store (studio, default...)
    const ids = await page.$$eval('.menu-project', (els) =>
      els.map((e) => (e as HTMLElement).dataset.projectId ?? ''));
    expect(ids.length).toBeGreaterThan(0);
    // AUCUN artefact e2e timestampe n'est affiche
    expect(ids.filter((id) => TEST_ARTIFACT.test(id))).toEqual([]);
    // RENFORCE 2026-08-27 (incident : le menu a envoye l'utilisateur sur
    // trace-kinds-433956, suffixe court passant l'ancien filtre) : les
    // PREFIXES de harnais sont masques quel que soit le suffixe.
    expect(ids.filter((id) => /^(e2e|trace|crit3)-/.test(id))).toEqual([]);
  });

  test('ouvrir un projet navigue vers ?project=<id> en preservant le fragment', async ({ page }) => {
    await page.goto('/#stoken=abc123');
    await page.waitForSelector('.menu-project', { timeout: 10000 });
    const firstId = await page.$eval('.menu-project', (e) => (e as HTMLElement).dataset.projectId);
    await page.locator('.menu-project').first().click();
    await page.waitForURL(/\?project=/, { timeout: 10000 });
    const url = page.url();
    expect(url).toContain(`project=${firstId}`);
    expect(url).toContain('stoken=abc123');  // fragment preserve
  });

  test('creer un nouveau projet navigue vers ?project=<nom>', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.menu-new-input', { timeout: 10000 });
    // nom SANS timestamp 13 chiffres (sinon re-masque par le filtre du menu)
    const cleanName = 'spec-nouveau-test';
    await page.locator('.menu-new-input').fill(cleanName);
    await page.locator('.menu-new-btn').click();
    await page.waitForURL(/\?project=/, { timeout: 10000 });
    expect(page.url()).toContain(`project=${cleanName}`);
  });
});
