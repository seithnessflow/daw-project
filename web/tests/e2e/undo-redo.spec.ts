// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * V1.3 invariants: UNDO IS A GESTURE, NEVER A REWIND.
 * 1. A drag (dozens of coalesced writes) is ONE undo entry.
 * 2. Undo of a delete restores the clip INTEGRALLY and converges.
 * 3. Undoing MY gesture never touches a concurrent remote gesture.
 * 4. Any fresh local op clears the redo stack.
 * 5. Ctrl+Z does not zoom (the bare-KeyZ bug, ultra-found).
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

const projectId = `undo-${Date.now()}`;

async function openTab(page: Page): Promise<void> {
  await page.goto(`/?project=${projectId}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

const clipStarts = (page: Page) =>
  page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    return d.tracks.map((t: any) =>
      t.clips.map((c: any) => ({ id: c.id, start: c.startSample }))
        .sort((a: any, b: any) => a.id.localeCompare(b.id)));
  });

async function placeClip(page: Page, laneIndex: number, x: number): Promise<void> {
  await page.locator('[data-role="sample"]').first().click();
  await page.locator('[data-track-id] .track-lane').nth(laneIndex)
    .click({ position: { x, y: 20 } });
  await page.locator('[data-role="sample"]').first().click(); // disarm
}

async function dragClip(page: Page, handleIndex: number, dx: number): Promise<void> {
  const handle = page.locator('[data-role="clip-handle"]').nth(handleIndex);
  const box = (await handle.boundingBox())!;
  // Tiny clips: aim the CENTER of the handle (a +10 offset overshoots a
  // 5px-wide clip and the drag grabs nothing - session B's lesson).
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(sx + (dx * i) / 8, sy);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.describe('Undo/redo (V1.3)', () => {
  test('gesture-grained, collab-safe, redo semantics, no zoom theft', async ({ context, page }) => {
    test.setTimeout(90000);
    const A = page;
    const B = await context.newPage();
    await openTab(A);
    await openTab(B);

    // Two clips on track 1 through the UI
    await placeClip(A, 0, 100);
    await placeClip(A, 0, 300);
    await expect(A.locator('.clip')).toHaveCount(2, { timeout: 10000 });
    await expect(B.locator('.clip')).toHaveCount(2, { timeout: 10000 });
    const initial = await clipStarts(A);

    // 1. Drag clip #0 far right: dozens of writes, ONE undo entry
    await dragClip(A, 0, 160);
    const afterDrag = await clipStarts(A);
    expect(JSON.stringify(afterDrag)).not.toBe(JSON.stringify(initial));
    await A.keyboard.press('Control+KeyZ');
    await A.waitForTimeout(400);
    await expect.poll(async () => JSON.stringify(await clipStarts(A)), {
      timeout: 5000, message: 'one Ctrl+Z did not restore the drag origin',
    }).toBe(JSON.stringify(initial));

    // 5. And that Ctrl+Z did NOT zoom
    const pps = await A.evaluate(async () =>
      (await import('/src/ui/track.ts')).TIMELINE.pps);
    expect(pps, 'Ctrl+Z stole the KeyZ zoom').toBe(20);

    // 2. Delete a clip, undo restores it integrally AND converges to B
    await A.locator('[data-role="clip-handle"]').first().click();
    await A.keyboard.press('Delete');
    await expect(A.locator('.clip')).toHaveCount(1);
    await A.keyboard.press('Control+KeyZ');
    await expect(A.locator('.clip')).toHaveCount(2);
    await expect.poll(async () => JSON.stringify(await clipStarts(B)), {
      timeout: 10000, message: 'undo of delete never converged to tab B',
    }).toBe(JSON.stringify(initial));

    // 3. Interleaved: B drags clip #1; A undoes ITS next own gesture -
    // B's move must survive in both tabs.
    await dragClip(B, 1, 120);
    const afterRemote = await clipStarts(B);
    await expect.poll(async () => JSON.stringify(await clipStarts(A)), {
      timeout: 10000 }).toBe(JSON.stringify(afterRemote));
    await dragClip(A, 0, 80);           // A's own gesture
    await A.keyboard.press('Control+KeyZ');  // undo A's gesture only
    await A.waitForTimeout(400);
    const afterUndo = await clipStarts(A);
    // clip #1 (B's move) intact, clip #0 back to its pre-gesture spot
    expect(JSON.stringify(afterUndo)).toBe(JSON.stringify(afterRemote));

    // 4. Redo works, and a fresh op clears it
    await A.keyboard.press('Control+KeyY');  // redo A's gesture
    await A.waitForTimeout(400);
    const afterRedo = await clipStarts(A);
    expect(JSON.stringify(afterRedo)).not.toBe(JSON.stringify(afterRemote));
    await A.keyboard.press('Control+KeyZ');  // undo again
    await A.waitForTimeout(300);
    await dragClip(A, 0, 40);                // fresh op -> redo cleared
    const beforeDeadRedo = await clipStarts(A);
    await A.keyboard.press('Control+KeyY');  // must be a no-op now
    await A.waitForTimeout(300);
    expect(JSON.stringify(await clipStarts(A)),
      'redo survived a fresh local op').toBe(JSON.stringify(beforeDeadRedo));

    await B.close();
  });
});
