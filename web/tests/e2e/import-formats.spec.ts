// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * IMPORT UNIVERSEL (AUDIT-6 QW) + POSE EN COUCHE + anti-doublon :
 * 1. un fichier ORDURE droppe = refus VISIBLE (flash), zero clip ;
 * 2. roundtrip de l'encodeur : ton synthetique -> encodeWav16 ->
 *    decodeAudioData = duree/taux conserves (la sonde __dawTranscode) ;
 * 3. MP3 REEL (voix systeme Windows) transcode au taux du projet et
 *    POSE en clip - test CONDITIONNEL (skip la ou le fichier n'existe
 *    pas, CI Linux) ;
 * 4. le clic ARME sur une position occupee POSE EN COUCHE (les snares
 *    perdues de la session de composition) ; le MEME sample au MEME pas
 *    est refuse visiblement (anti-flam).
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import { waitForServerConnection } from './helpers';

const SYS_MP3 =
  'C:\\Windows\\ImmersiveControlPanel\\SystemSettings\\Assets\\Aria.mp3';

async function dropFile(page: import('@playwright/test').Page,
  laneSel: string, name: string, mime: string, b64: string): Promise<void> {
  await page.evaluate(({ sel, name, mime, b64 }) => {
    const lane = document.querySelector(sel) as HTMLElement;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type: mime }));
    const rect = lane.getBoundingClientRect();
    lane.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: dt,
      clientX: rect.left + 40, clientY: rect.top + 10,
    }));
  }, { sel: laneSel, name, mime, b64 });
}

test('ordure refusee visiblement ; roundtrip encodeur exact', async ({ page }) => {
  const projectId = `e2e-import-${Date.now()}`;
  await page.goto(`/?project=${projectId}`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });

  // (1) ordure -> refus visible, zero clip
  const junk = Buffer.from(
    Array.from({ length: 512 }, (_, i) => (i * 37) % 251)).toString('base64');
  const lane = '[data-track-id] .track-lane';
  await dropFile(page, lane, 'pas-audio.xyz', 'application/octet-stream', junk);
  await expect(page.locator(lane).first()).toHaveClass(/kind-refused/,
    { timeout: 5000 });
  const clips = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    return d.tracks.reduce((n: number, t: any) => n + t.clips.length, 0);
  });
  expect(clips).toBe(0);

  // (2) roundtrip : ton 440 Hz 0.5 s a 44.1k -> transcode a 48k ->
  // redecodage : duree conservee, taux = projet
  const rt = await page.evaluate(async () => {
    const src = new OfflineAudioContext(1, 22050, 44100);
    const osc = src.createOscillator();
    osc.frequency.value = 440;
    osc.connect(src.destination);
    osc.start();
    const tone = await src.startRendering();  // 0.5 s @ 44100, mono
    const wav16 = (window as any).__dawTranscode(
      await new Response(new Blob([
        // encode via le transcodeur lui-meme : on lui donne un WAV source
        // fabrique par un DEUXIEME appel ? Non - le transcodeur attend des
        // OCTETS ; on fabrique d'abord un wav 44.1k avec l'encodeur du
        // navigateur... la sonde ne l'expose pas. Astuce : transcoder le
        // rendu PCM passe par un WAV intermediaire fait main minimal.
        (() => {
          const frames = tone.length;
          const out = new ArrayBuffer(44 + frames * 2);
          const v = new DataView(out);
          const w4 = (o: number, s: string) => {
            for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i));
          };
          w4(0, 'RIFF'); v.setUint32(4, 36 + frames * 2, true); w4(8, 'WAVE');
          w4(12, 'fmt '); v.setUint32(16, 16, true);
          v.setUint16(20, 1, true); v.setUint16(22, 1, true);
          v.setUint32(24, 44100, true); v.setUint32(28, 44100 * 2, true);
          v.setUint16(32, 2, true); v.setUint16(34, 16, true);
          w4(36, 'data'); v.setUint32(40, frames * 2, true);
          const d0 = tone.getChannelData(0);
          for (let i = 0; i < frames; i++) {
            v.setInt16(44 + i * 2,
              Math.round(Math.max(-1, Math.min(1, d0[i])) * 32767), true);
          }
          return out;
        })(),
      ])).arrayBuffer(), 48000);
    const back = await new OfflineAudioContext(1, 2, 48000)
      .decodeAudioData(await wav16);
    return { rate: back.sampleRate, sec: back.duration };
  });
  expect(rt.rate).toBe(48000);
  expect(Math.abs(rt.sec - 0.5)).toBeLessThan(0.01);
});

test('un MP3 systeme reel se transcode et se pose en clip', async ({ page }) => {
  test.skip(!fs.existsSync(SYS_MP3), 'MP3 systeme absent (CI Linux)');
  const projectId = `e2e-import-mp3-${Date.now()}`;
  await page.goto(`/?project=${projectId}`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });

  const b64 = fs.readFileSync(SYS_MP3).toString('base64');
  await dropFile(page, '[data-track-id] .track-lane', 'Aria.mp3',
    'audio/mpeg', b64);
  // Le clip apparait (transcode + PUT store + addClip)
  await expect
    .poll(async () => page.evaluate(() => {
      const d = (window as any).__dawProject.getDocument();
      return d.tracks.reduce((n: number, t: any) => n + t.clips.length, 0);
    }), { timeout: 15000 }).toBe(1);
  const clip = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    const t = d.tracks.find((x: any) => x.clips.length > 0);
    return { name: t.clips[0].name, len: t.clips[0].lengthSamples,
      sr: d.sampleRate };
  });
  expect(clip.name).toBe('Aria');
  // ~7 s de voix -> une longueur plausible au taux du projet
  expect(clip.len).toBeGreaterThan(clip.sr * 1);
  expect(clip.len).toBeLessThan(clip.sr * 30);
});

test('clic arme sur position occupee = POSE en couche ; meme pas = refus', async ({ page }) => {
  const projectId = `e2e-layer-${Date.now()}`;
  await page.goto(`/?project=${projectId}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('.sample-chip', { timeout: 10000 });
  const lane = page.locator('[data-track-id] .track-lane').first();

  // kick a 0 s, puis SNARE au meme endroit : pose EN COUCHE (2 clips)
  await page.locator('.sample-chip[data-sample-name="kick"]').click();
  await lane.click({ position: { x: 4, y: 20 } });
  await page.locator('.sample-chip[data-sample-name="snare"]').click();
  await lane.click({ position: { x: 4, y: 20 }, force: true });
  const count2 = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    return d.tracks[0].clips.length;
  });
  expect(count2, 'la couche kick+snare doit faire 2 clips').toBe(2);

  // re-SNARE exactement au meme pas : refus visible, toujours 2 clips
  await lane.click({ position: { x: 4, y: 20 }, force: true });
  await expect(lane).toHaveClass(/kind-refused/);
  const count3 = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    return d.tracks[0].clips.length;
  });
  expect(count3).toBe(2);
});
