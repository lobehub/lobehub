import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { analyzeRun, createRunAnalyzer } from '../analyze/diff';
import { launchBrowser } from './browser';
import {
  capturePage,
  captureRun,
  captureSections,
  conditionFromLabel,
  inspectCaseGaps,
} from './runner';
import type { StyleSnapshot } from './snapshot';
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
  const scrollbar = (name: string, width: string) =>
    page(`.${name} ::-webkit-scrollbar { width: ${width}; }`).replace(
      'class="row"',
      `class="${name}"`,
    );
  await write('base-scrollbar', scrollbar('lobe-share-7976-preview', '4px'));
  await write('head-scrollbar', scrollbar('css-1x2y3z', '4px'));
  await write('head-scrollbar-wide', scrollbar('css-1x2y3z', '8px'));
  await write(
    'base-elsewhere-container',
    page(
      '.t { color: black; } @container grid (min-width: 560px) { .elsewhere > :nth-child(n+3) { display: flex; } } .elsewhere:has(> :where(button, a):active) { color: red; }',
    ),
  );
  await write(
    'base-document-pseudo',
    page('.t { color: black; } ::view-transition-old(panel) { animation-duration: 240ms; }'),
  );
  await write(
    'base-ancestor-not',
    page(
      '.t { color: black; } @media (hover: hover) and (pointer: fine) { .x1a2b3c.x1a2b3c.x1a2b3c:where(.lhewz77w:not(:hover, :focus-within) *) { opacity: 0; } }',
    ),
  );
  await write(
    'base-unparsable',
    page(
      '.t { color: black; }',
      "const sheet = document.createElement('style'); sheet.textContent = '@namespace svg url(http://www.w3.org/2000/svg); @media (hover: hover) { svg|a { color: red; } }'; document.head.prepend(sheet);",
    ),
  );
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
    'base-ancestor-focus',
    page('.t { color: black; } .row:focus-visible .t { color: red; }'),
  );
  await write('head-ancestor-focus', page('.t { color: black; }'));
  await write('base-checked', page('.t { color: black; } .t:checked { background-color: red; }'));
  await write('head-checked', page('.t { color: black; } .t:checked { background-color: blue; }'));
  await write(
    'static-pseudo',
    page('.t { color: black; } .t:first-child:not(:empty) { color: black; }'),
  );
  const pair = (css: string) => `<!doctype html><html><head><style>
body { margin: 0; font: 14px Arial; }
${css}
</style></head><body><div id="app" data-synthetic-ready="true"><main data-synthetic-cases="">
<section data-case="a.tsx|A#0|0"><div data-synthetic-element="A#0" class="same">Same</div></section>
<section data-case="b.tsx|B#0|0"><div data-synthetic-element="B#0" class="moved">Moved</div></section>
</main></div></body></html>`;
  await write('base-pair', pair('.same { color: black; --tone: 1; } .moved { color: red; }'));
  await write('head-pair', pair('.same { color: black; --tone: 2; } .moved { color: blue; }'));
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

  it('forces a non-hover state on the ancestor chain when only an ancestor carries it', async () => {
    const [result] = await run('base-ancestor-focus', 'head-ancestor-focus');
    expect(result.status).toBe('difference');
    expect(result.differingConditions).toContain('light/1280/force-chain:focus-visible');
  });

  it('flags a case whose state-dependent pseudo-class rules differ as a coverage gap', async () => {
    const [result] = await run('base-checked', 'head-checked');
    expect(result).toMatchObject({ gaps: ['STATE_UNMODELED'], status: 'equal' });
  });

  it('reports state gaps between any two pages, such as an original head and its mutant', async () => {
    const gaps = await inspectCaseGaps(
      browser,
      { base: `${server.url}/base-checked/`, head: `${server.url}/head-checked/` },
      conditionFromLabel('light/1280/hover-target'),
      [],
    );
    expect(gaps).toEqual({ 'a.tsx|A#0': ['STATE_UNMODELED'] });
  });

  it('matches an unmodeled pseudo rule kept verbatim under a different class on the same element', async () => {
    const [same] = await run('base-scrollbar', 'head-scrollbar');
    expect(same.gaps).toEqual([]);
    const [changed] = await run('base-scrollbar', 'head-scrollbar-wide');
    expect(changed.gaps).toEqual(['PSEUDO_UNMODELED']);
  });

  it('does not pin a rule on a case when only its pseudo parts were stripped', async () => {
    const [result] = await run('base-elsewhere-container', 'head-media');
    expect(result.gaps).toEqual([]);
  });

  it('does not pin a document-level pseudo rule on every case', async () => {
    const [result] = await run('base-document-pseudo', 'head-media');
    expect(result.gaps).toEqual([]);
  });

  it('keeps a rule whose functional pseudo nests a comma off cases that do not carry its class', async () => {
    const capture = await captureRun({
      browser,
      conditions: { themeAttribute: 'data-theme', themes: ['light'], widths: [1280] },
      urls: { base: `${server.url}/base-ancestor-not/`, head: `${server.url}/head-media/` },
    });
    expect(capture.caseGaps).toEqual({});
    expect(capture.unparsedSelectors).toEqual([]);
  });

  it('reports a selector the page cannot evaluate instead of pinning it on every case', async () => {
    const capture = await captureRun({
      browser,
      conditions: { themeAttribute: 'data-theme', themes: ['light'], widths: [1280] },
      urls: { base: `${server.url}/base-unparsable/`, head: `${server.url}/head-media/` },
    });
    expect(capture.caseGaps).toEqual({});
    expect(capture.unparsedSelectors).toEqual(['svg|a']);
  });

  it('does not flag structural pseudo-classes the default capture already evaluates', async () => {
    const [result] = await run('static-pseudo', 'head-media');
    expect(result.gaps).toEqual([]);
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

  it('transfers full snapshots only for sections whose loads differ beyond custom properties', async () => {
    const capture = await captureRun({
      browser,
      conditions: { themeAttribute: 'data-theme', themes: ['light'], widths: [1280] },
      states: ['default'],
      urls: { base: `${server.url}/base-pair/`, head: `${server.url}/head-pair/` },
    });
    const condition = capture.conditions.find((item) => item.condition === 'light/1280/default')!;
    expect(condition.identical).toEqual(['a.tsx|A#0|0']);
    expect(Object.keys(condition.head)).toEqual(['b.tsx|B#0|0']);
    expect(
      Object.fromEntries(analyzeRun(capture).map((result) => [result.key, result.status])),
    ).toEqual({ 'a.tsx|A#0': 'equal', 'b.tsx|B#0': 'difference' });
  });

  it('transfers differing sections with the same styles a direct capture reads', async () => {
    const capture = await captureRun({
      browser,
      conditions: { themeAttribute: 'data-theme', themes: ['light'], widths: [1280] },
      plan: [conditionFromLabel('light/1280/default')],
      urls: { base: `${server.url}/base-pair/`, head: `${server.url}/head-pair/` },
    });
    const { page, snapshots } = await capturePage(
      browser,
      `${server.url}/head-pair/`,
      conditionFromLabel('light/1280/default'),
      [],
    );
    await page.close();
    const direct = snapshots['b.tsx|B#0|0'] as StyleSnapshot;
    const transferred = capture.conditions[0].head['b.tsx|B#0|0'] as StyleSnapshot;
    const standard = (style: Record<string, string>) =>
      Object.fromEntries(Object.entries(style).filter(([name]) => !name.startsWith('--')));
    expect(transferred.styles).toEqual(direct.styles.map(standard));
    expect(transferred.nodes).toEqual(direct.nodes);
  });

  it('compares any number of pages and transfers only sections that differ among them', async () => {
    const { identical, snapshots } = await captureSections(
      browser,
      [`${server.url}/base-pair/`, `${server.url}/base-pair/`, `${server.url}/head-pair/`],
      conditionFromLabel('light/1280/default'),
      [],
    );
    expect(identical).toEqual(['a.tsx|A#0|0']);
    expect(snapshots.map((item) => Object.keys(item))).toEqual([
      ['b.tsx|B#0|0'],
      ['b.tsx|B#0|0'],
      ['b.tsx|B#0|0'],
    ]);
  });

  it('reports equal pages as equal', async () => {
    const [result] = await run('head-hover', 'head-media');
    expect(result).toMatchObject({ differingConditions: [], status: 'equal' });
  });
});
