import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium, expect } from '@playwright/test';

// Build workbench:build:report and the CLI first. Optional args select a built
// CLI and an installed Chromium executable; no account or server is needed.
const cli = path.resolve(
  process.argv[2] ?? fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url)),
);
const root = mkdtempSync(path.join(tmpdir(), 'lh-offline-report-'));
const acceptance = path.join(root, '.acceptances/standalone-offline');
const round = path.join(acceptance, '20260101-090000-resources');
const downloads = path.join(root, 'Downloads');
const run = (...args) =>
  JSON.parse(
    execFileSync(process.execPath, [cli, 'acceptance', ...args, '--json'], {
      cwd: root,
      encoding: 'utf8',
      env: { HOME: root, LOBEHUB_ACCEPTANCE_DOWNLOADS: downloads, PATH: process.env.PATH },
    }),
  );
let browser;

try {
  mkdirSync(path.join(round, 'assets'), { recursive: true });
  mkdirSync(downloads);
  writeFileSync(
    path.join(round, 'assets/resources.md'),
    [
      '# Offline resources',
      '中文与 English. This is a synthetic rendering fixture, not acceptance evidence.',
      '```js\nconst total = 12.35 * 3;\n```',
      '$E=mc^2$',
      '$$\\frac{1}{2}+\\sum_{n=1}^{3}n=6.5$$',
      '```mermaid\nflowchart LR\n A[Local files] --> B[Offline report]\n```',
      '![Remote image](https://example.com/image.png)',
      '![Protocol relative](//example.com/image.png)',
      '<video src="https://example.com/video.mp4" />',
    ].join('\n\n'),
  );
  writeFileSync(
    path.join(round, 'result.json'),
    JSON.stringify({
      cases: [
        {
          evidence: [{ path: 'assets/resources.md' }],
          id: 'resources',
          name: 'Read offline',
          status: 'uncertain',
        },
      ],
      plan: [{ id: 'resources', requiredEvidence: ['markdown'], title: 'Read offline' }],
      summary: { conclusion: 'Synthetic rendering fixture', verdict: 'uncertain' },
      title: 'Offline report regression',
    }),
  );
  const rendered = run('run', 'render', round, '--requirement', 'Review without network access');
  browser = await chromium.launch({
    ...(process.argv[3] ? { executablePath: process.argv[3] } : { channel: 'chrome' }),
    headless: true,
  });
  const context = await browser.newContext({ acceptDownloads: true, offline: true });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  page.on('websocket', (socket) => requests.push(socket.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${pathToFileURL(rendered.reportPath).href}?hl=en-US`);
  await expect(page.getByRole('heading', { name: 'Offline report regression' })).toBeVisible();
  await page.getByRole('button', { name: 'resources.md', exact: true }).click();
  await expect(page.locator('.katex')).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('svg.lobe-brand-lobe-hub')).toBeVisible();
  await expect(page.locator('.lobe-mermaid svg')).toBeVisible();
  await expect(
    page.getByText('External media is not loaded in local reports.', { exact: false }),
  ).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Protocol relative' })).toHaveAttribute(
    'href',
    'https://example.com/image.png',
  );
  assert.ok(
    await page.evaluate(() =>
      [...document.fonts].some((font) => font.family === 'KaTeX_Main' && font.status === 'loaded'),
    ),
  );
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save reviews', exact: true }).click();
  const download = await downloading;
  await download.saveAs(path.join(downloads, download.suggestedFilename()));
  const bundle = run('view', acceptance);
  assert.equal(bundle.checks[0].userReview.action, 'accept');
  assert.equal(
    JSON.parse(readFileSync(path.join(acceptance, 'reviews.json'), 'utf8')).events.length,
    1,
  );
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: packaged report, offline logo/math/diagram, external media links, saved review JSON',
  );
} finally {
  await browser?.close();
  rmSync(root, { force: true, recursive: true });
}
