// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium } from '@playwright/test';
import { expect, it } from 'vitest';

import { captureScreenshotEvidence } from './screenshotEvidence';

it('distinguishes stable equal pixels, a real repaint, and a noisy A/A control', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'stylex-pixel-test-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const pages = await Promise.all(
      Array.from({ length: 3 }, () => browser.newPage({ viewport: { width: 100, height: 100 } })),
    );
    await Promise.all(
      pages.map((page) =>
        page.setContent(
          '<style>body{margin:0}div{width:20px;height:20px;background:red}</style><div></div>',
        ),
      ),
    );
    const equal = await captureScreenshotEvidence(pages, output, 'equal');
    expect(equal.aaStable).toBe(true);
    expect(equal.candidate.changedPixels).toBe(0);
    await pages[2].locator('div').evaluate((node) => {
      node.style.background = 'blue';
    });
    const changed = await captureScreenshotEvidence(pages, output, 'changed');
    expect(changed.aaStable).toBe(true);
    expect(changed.candidate.changedPixels).toBe(400);
    expect(await readFile(path.join(output, 'changed-diff.png'))).not.toHaveLength(0);
    await pages[1].locator('div').evaluate((node) => {
      node.style.background = 'green';
    });
    expect((await captureScreenshotEvidence(pages, output, 'noisy')).aaStable).toBe(false);
  } finally {
    await browser.close();
    await rm(output, { force: true, recursive: true });
  }
});
