// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pre-ecoute des samples (AUDIT-6 QW) : l'onglet Samples du navigateur
 * porte un ▶ par chip - clic = le sample JOUE (WebAudio, fetch du store),
 * re-clic = stop. Preuves : l'etat .playing suit le geste, ecouter
 * n'ARME pas le chip (aria-pressed reste false), et le refus est VISIBLE
 * quand le store n'a pas l'asset.
 *
 * Pas de moteur ici : la pre-ecoute est 100% navigateur + store serveur.
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { waitForServerConnection, REPO_ROOT, resolveBinary } from './helpers';

test('le ▶ d un chip joue puis arrete le sample, sans l armer', async ({ page }) => {
  test.setTimeout(60000);
  const createTestDoc = resolveBinary('CREATE_TEST_DOC', 'create_test_doc');
  const projectId = `e2e-preview-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-e2e-preview-'));

  execFileSync(createTestDoc, [path.join(dir, 'base.am'), dir, '2'], {
    encoding: 'utf-8',
  });
  execFileSync(
    'node',
    ['scripts/seed-again.mjs', '--base', path.join(dir, 'base.am'),
     '--assets', dir, '--project', projectId],
    { cwd: path.join(REPO_ROOT, 'web'), stdio: 'pipe' }
  );

  // Le store serveur doit AVOIR le sample (seed-again ne copie qu'en
  // local) : PUT du tone sous son adresse de contenu.
  const toneWav = fs.readdirSync(dir).find((f) => /^[0-9a-f]{64}\.wav$/.test(f));
  expect(toneWav, `no hashed wav in ${dir}`).toBeTruthy();
  const hash = toneWav!.replace(/\.wav$/, '');
  const put = await fetch(`http://localhost:3000/assets/${hash}`, {
    method: 'PUT',
    body: fs.readFileSync(path.join(dir, toneWav!)),
  });
  expect(put.ok, `store PUT failed: ${put.status}`).toBe(true);

  await page.goto(`/?project=${projectId}`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });

  // Onglet Samples du rail
  await page.locator('.browser-tab', { hasText: 'Samples' }).click();
  const chip = page.locator('.sample-chip').first();
  await expect(chip).toBeVisible();
  const pv = chip.locator('.chip-preview');

  // Jouer : .playing + ■ ; le chip n'est PAS arme par l'ecoute
  await pv.click();
  await expect(pv).toHaveClass(/playing/, { timeout: 5000 });
  await expect(chip).toHaveAttribute('aria-pressed', 'false');

  // Stop au re-clic (le tone fait ~2 s - on n'attend pas sa fin)
  await pv.click();
  await expect(pv).not.toHaveClass(/playing/);

  // Fin naturelle : rejouer et laisser finir -> l'etat retombe seul
  await pv.click();
  await expect(pv).toHaveClass(/playing/);
  await expect(pv).not.toHaveClass(/playing/, { timeout: 15000 });
});

test('store sans l asset = refus VISIBLE du ▶', async ({ page }) => {
  const createTestDoc = resolveBinary('CREATE_TEST_DOC', 'create_test_doc');
  const projectId = `e2e-preview-miss-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-e2e-previewm-'));
  execFileSync(createTestDoc, [path.join(dir, 'base.am'), dir, '2'], {
    encoding: 'utf-8',
  });
  execFileSync(
    'node',
    ['scripts/seed-again.mjs', '--base', path.join(dir, 'base.am'),
     '--assets', dir, '--project', projectId],
    { cwd: path.join(REPO_ROOT, 'web'), stdio: 'pipe' }
  );
  // Le store est ADRESSE CONTENU et partage entre tests (le meme tone a
  // deja ete PUT par le test precedent) : « absent du store » se simule
  // en interceptant la requete - un 404 force, deterministe.
  await page.route('**/assets/*', (route) =>
    route.fulfill({ status: 404, body: 'not here' }));

  await page.goto(`/?project=${projectId}`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
  await page.locator('.browser-tab', { hasText: 'Samples' }).click();

  const pv = page.locator('.sample-chip').first().locator('.chip-preview');
  await pv.click();
  await expect(pv).toHaveClass(/refused/, { timeout: 5000 });
  const title = await pv.getAttribute('title');
  expect(title).toContain('Pre-ecoute impossible');
});
