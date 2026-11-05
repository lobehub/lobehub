import type { Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchBrowser } from '../capture/browser';
import { runCssCorpus } from './run';

let browser: Browser;

beforeAll(async () => {
  browser = await launchBrowser();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe('CSS boundary corpus', () => {
  it('gives every entry its expected outcome', async () => {
    const results = await runCssCorpus({ browser });
    expect(results).toHaveLength(33);
    expect(
      results
        .filter((entry) => !entry.passed)
        .map((entry) => `${entry.id}: expected ${entry.expected}, got ${entry.actual}`),
    ).toEqual([]);
  }, 300_000);
});
