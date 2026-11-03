import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from './index';

let root: string;
let runDir: string;
let repo: string;
let server: Awaited<ReturnType<typeof startServer>>;

const item = (key: string, category: string, flags: string[] = []) => ({
  category,
  file: 'src/A.tsx',
  flags,
  hash: `hash-${key}`,
  key,
  signoff: 'missing',
});

const write = (name: string, value: unknown) =>
  writeFile(path.join(runDir, name), JSON.stringify(value));

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'style-eq-server-'));
  runDir = path.join(root, 'run');
  repo = path.join(root, 'repo');
  await mkdir(path.join(runDir, 'dist-base'), { recursive: true });
  await mkdir(path.join(runDir, 'dist-head'), { recursive: true });
  await mkdir(repo);
  const page = (color: string) =>
    `<!doctype html><html><head><style>body{margin:0;font:14px Arial}.t{color:${color}}</style></head><body><div id="app" data-synthetic-ready="true"><main data-synthetic-cases=""><section data-case="src/A.tsx|A#1|0" style="width:360px;padding:8px"><span data-synthetic-element="A#1" class="t">Text</span></section></main></div></body></html>`;
  await writeFile(path.join(runDir, 'dist-base/index.html'), page('black'));
  await writeFile(path.join(runDir, 'dist-head/index.html'), page('red'));
  await writeFile(path.join(root, 'secret.txt'), 'secret');
  await symlink(path.join(root, 'secret.txt'), path.join(runDir, 'dist-base/leak.txt'));
  await write('run.json', {
    base: 'a'.repeat(40),
    conditionConfig: {
      themeAttribute: 'data-theme',
      themes: ['light'],
      variants: [],
      widths: [1280],
    },
    head: 'b'.repeat(40),
    repo,
    runId: 'run-1',
    states: ['default'],
  });
  await write('results.json', {
    cases: [
      {
        category: 'difference',
        key: 'src/A.tsx|A#0',
        plan: { file: 'src/A.tsx', flags: [] },
        result: {},
      },
      {
        category: 'needs-signoff',
        key: 'src/A.tsx|A#1',
        plan: { file: 'src/A.tsx', flags: ['PLACEMENT_SUBSTITUTED'] },
        result: {},
      },
    ],
  });
  await write('verdict.json', {
    items: [
      item('src/A.tsx|A#0', 'difference'),
      item('src/A.tsx|A#1', 'needs-signoff', ['PLACEMENT_SUBSTITUTED']),
    ],
    mergeable: false,
    reasons: [],
  });
  await write('mutation.json', { passed: true });
  await write('calibration.json', []);
  await write('evidence.json', {
    'src/A.tsx|A#1': { declarations: { head: { 'styles.a': 'a: {}' } } },
  });
  server = await startServer({ runDir });
});

afterAll(async () => {
  await server?.stop();
  await rm(root, { force: true, recursive: true });
});

const post = (url: string, body: unknown) =>
  fetch(`${server.url}${url}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

describe('report server', () => {
  it('returns the stored run with its verdict', async () => {
    const response = await fetch(`${server.url}/api/run`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.run.runId).toBe('run-1');
    expect(body.verdict).toMatchObject({
      mergeable: false,
      reasons: ['difference 1', 'needs sign-off 1'],
    });
  });

  it('returns one case with its evidence', async () => {
    const response = await fetch(`${server.url}/api/case/${encodeURIComponent('src/A.tsx|A#1')}`);
    const body = await response.json();
    expect(body.case.category).toBe('needs-signoff');
    expect(body.evidence.declarations.head['styles.a']).toBe('a: {}');
    expect(body.item.signoff).toBe('missing');
  });

  it('refuses to sign an unflagged difference', async () => {
    const response = await post('/api/signoff', {
      keys: ['src/A.tsx|A#0'],
      note: 'looks fine',
      reason: 'TOOL_FALSE_POSITIVE',
      signer: 'innei',
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/^UNFLAGGED_DIFFERENCE/);
  });

  it('writes a valid sign-off into the repository and recomputes the verdict', async () => {
    const response = await post('/api/signoff', {
      keys: ['src/A.tsx|A#1'],
      note: 'div stands in for the antd Image',
      reason: 'PLACEMENT_SUBSTITUTED',
      signer: 'innei',
    });
    expect(response.status).toBe(200);
    expect((await response.json()).verdict.reasons).toEqual(['difference 1']);
    const stored = JSON.parse(
      await readFile(path.join(repo, '.style-equivalence/signoffs/src/A.tsx.json'), 'utf8'),
    );
    expect(stored).toMatchObject([{ hash: 'hash-src/A.tsx|A#1', reason: 'PLACEMENT_SUBSTITUTED' }]);
  });

  it('captures one case again from the stored builds', async () => {
    const response = await post(`/api/case/${encodeURIComponent('src/A.tsx|A#1')}/rerun`, {});
    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(result).toMatchObject({
      differingConditions: ['light/1280/default'],
      status: 'difference',
    });
  }, 60_000);

  it('serves the builds and nothing outside them', async () => {
    expect(await (await fetch(`${server.url}/base/`)).text()).toContain(
      'data-case="src/A.tsx|A#1|0"',
    );
    expect((await fetch(`${server.url}/base/leak.txt`)).status).toBe(404);
    expect((await fetch(`${server.url}/base/..%2F..%2Fsecret.txt`)).status).toBe(404);
    expect((await fetch(`${server.url}/api/case/missing`)).status).toBe(404);
  });
});
