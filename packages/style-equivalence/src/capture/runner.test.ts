import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { analyzeRun, createRunAnalyzer } from '../analyze/diff';
import { launchBrowser } from './browser';
import { captureRun, conditionFromLabel } from './runner';
import { serveDirectories } from './staticServer';

let root: string;
let server: Awaited<ReturnType<typeof serveDirectories>>;
let browser: Awaited<ReturnType<typeof launchBrowser>>;

const page = (css: string, extraScript = '') => `<!doctype html><html><head><style>
body { margin: 0; font: 14px Arial; }
${css}
</style></head><body><div id="app" data-synthetic-ready="true">
<main data-synthetic-cases="">
<section data-case="a.tsx|A#0|0" style="width:360px;padding:8px"><div data-synthetic-element="A#0" class="row"><span data-synthetic-element="A#1" class="t">Text</span></div></section>
</main></div>
<script>const theme = new URLSearchParams(location.search).get('theme'); if (theme) document.documentElement.setAttribute('data-theme', theme); ${extraScript}</script>
</body></html>`;

const write = async (name: string, html: string) => {
  await mkdir(path.join(root, name), { recursive: true });
  await writeFile(path.join(root, name, 'index.html'), html);
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'style-eq-capture-'));
  await write('base-hover', page('.t { color: black; } .t:hover { color: red; }'));
  await write('head-hover', page('.t { color: black; }'));
  await write(
    'base-media',
    page('.t { color: black; } @media (max-width: 600px) { .t { color: red; } }'),
  );
  await write('head-media', page('.t { color: black; }'));
  await write(
    'unrelated-media',
    page('.t { color: black; } @media (max-width: 900px) { .elsewhere { color: red; } }'),
  );
  await write('base-dark', page('.t { color: black; } [data-theme="dark"] .t { color: white; }'));
  await write('head-dark', page('.t { color: black; }'));
  await write(
    'noisy',
    page(
      '.t { color: black; }',
      "document.querySelector('.t').style.width = Math.random() * 100 + 'px';",
    ),
  );
  const fade = (name: string) =>
    page(
      `.t { color: black; animation: ${name} 1ms; } @keyframes ${name} { from { opacity: 0; } to { opacity: 1; } }`,
    );
  await write('base-fade', fade('enter'));
  await write('head-fade', fade('lobe-x-enter'));
  server = await serveDirectories(root);
  browser = await launchBrowser();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  await rm(root, { force: true, recursive: true });
});

const run = async (base: string, head: string, widths = [1280]) =>
  analyzeRun(
    await captureRun({
      browser,
      conditions: { themeAttribute: 'data-theme', themes: ['light', 'dark'], widths },
      urls: { base: `${server.url}/${base}/`, head: `${server.url}/${head}/` },
    }),
  );

describe('captureRun + analyzeRun', () => {
  it('reports a hover-only difference only under hover states', async () => {
    const [result] = await run('base-hover', 'head-hover');
    expect(result.status).toBe('difference');
    expect(result.differingConditions.sort()).toEqual([
      'dark/1280/hover-chain',
      'dark/1280/hover-target',
      'light/1280/hover-chain',
      'light/1280/hover-target',
    ]);
  });

  it('adds the width partition a media query creates and reports only there', async () => {
    const [result] = await run('base-media', 'head-media');
    expect(result.differingConditions.every((condition) => !condition.includes('/1280/'))).toBe(
      true,
    );
    expect(result.differingConditions).toContain('light/600/default');
  });

  it('ignores media rules that match nothing inside a case', async () => {
    const capture = await captureRun({
      browser,
      conditions: { themeAttribute: 'data-theme', themes: ['light'], widths: [1280] },
      states: ['default'],
      urls: { base: `${server.url}/unrelated-media/`, head: `${server.url}/head-media/` },
    });
    expect(capture.widths).toEqual([1280]);
  });

  it('reports a theme-only difference only in that theme', async () => {
    const [result] = await run('base-dark', 'head-dark');
    expect(result.differingConditions.every((condition) => condition.startsWith('dark/'))).toBe(
      true,
    );
    expect(result.rootCauses).toEqual([
      expect.objectContaining({
        after: 'rgb(0, 0, 0)',
        before: 'rgb(255, 255, 255)',
        property: 'color',
      }),
    ]);
  });

  it('marks a case whose base disagrees with itself as unstable', async () => {
    const [result] = await run('noisy', 'head-hover');
    expect(result.status).toBe('unstable');
  });

  it('treats renamed keyframes with the same frames as equal after the animation ends', async () => {
    const [result] = await run('base-fade', 'head-fade');
    expect(result).toMatchObject({ differingConditions: [], status: 'equal' });
  });

  it('streams conditions to an analyzer without keeping their snapshots', async () => {
    const analyzer = createRunAnalyzer();
    const capture = await captureRun({
      browser,
      conditions: { themeAttribute: 'data-theme', themes: ['light', 'dark'], widths: [1280] },
      onCondition: analyzer.add,
      urls: { base: `${server.url}/base-dark/`, head: `${server.url}/head-dark/` },
    });
    expect(capture.conditions.every((condition) => !Object.keys(condition.head).length)).toBe(true);
    const [result] = analyzer.finish(capture.caseGaps);
    expect(result.differingConditions).toEqual([
      'dark/1280/default',
      'dark/1280/hover-chain',
      'dark/1280/hover-target',
      'dark/1280/focus-visible',
    ]);
  });

  it('captures exactly the conditions of a fixed plan', async () => {
    const capture = await captureRun({
      browser,
      conditions: { themeAttribute: 'data-theme', themes: ['light'], widths: [1280] },
      plan: [conditionFromLabel('dark/375/hover-target')],
      urls: { base: `${server.url}/base-dark/`, head: `${server.url}/head-dark/` },
    });
    expect(capture.conditions.map((condition) => condition.condition)).toEqual([
      'dark/375/hover-target',
    ]);
    expect(analyzeRun(capture)[0].differingConditions).toEqual(['dark/375/hover-target']);
  });

  it('reports equal pages as equal', async () => {
    const [result] = await run('head-hover', 'head-media');
    expect(result).toMatchObject({ differingConditions: [], status: 'equal' });
  });
});
