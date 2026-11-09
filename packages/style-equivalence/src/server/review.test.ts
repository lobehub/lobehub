import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { annotateList, applyNotes, reworkList } from '../cli/review';
import { loadRun } from './api';
import { startServer } from './index';

let root: string;
let runDir: string;
let server: Awaited<ReturnType<typeof startServer>>;

const element = (id: string, tag: string, slots: string[], extra: object = {}) => ({
  bindings: [{ expr: slots[0], prop: 'className', spread: false }],
  flags: [],
  id,
  literalProps: {},
  owner: id.split('#')[0],
  slots,
  tag,
  variables: [],
  ...extra,
});

const kase = (
  id: string,
  category: string,
  flags: string[],
  combos: object[] = [{}],
  extra: object = {},
) => ({
  category,
  key: `src/A.tsx|${id}`,
  plan: {
    combos,
    elementIds: { base: id, head: id },
    file: 'src/A.tsx',
    flags,
    key: `src/A.tsx|${id}`,
    variables: [],
    ...extra,
  },
  result: {
    comboDifferences: [],
    differingConditions: category === 'difference' ? ['light/1280/default'] : [],
    errors: [],
    gaps: [],
    rootCauses:
      category === 'difference'
        ? [{ after: 'red', before: 'black', key: 'root', property: 'color' }]
        : [],
    status: category === 'difference' ? 'difference' : 'equal',
    unstableConditions: [],
  },
});

const verdictItem = (id: string, category: string, flags: string[]) => ({
  category,
  file: 'src/A.tsx',
  flags,
  hash: `hash-${id}`,
  key: `src/A.tsx|${id}`,
});

const write = (name: string, value: unknown) =>
  writeFile(path.join(runDir, name), JSON.stringify(value));

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'style-eq-review-'));
  runDir = path.join(root, 'run-1');
  await mkdir(runDir, { recursive: true });
  await write('run.json', {
    base: 'a'.repeat(40),
    conditions: ['light/1280/default', 'dark/1280/default'],
    head: 'b'.repeat(40),
    pr: { branch: 'style/x', number: 21054, title: 'move builtin tool styles' },
    runId: 'run-1',
  });
  await write('results.json', {
    cases: [
      kase('A#0', 'difference', []),
      kase('A#1', 'needs-signoff', ['VARIABLE_UNMODELED'], [{ online: false }, { online: true }]),
      kase('A#2', 'needs-signoff', ['PLACEMENT_SUBSTITUTED'], [{}], {
        standIns: { head: ['SkillsIcon'] },
      }),
      kase('A#3', 'equal', []),
    ],
  });
  await write('verdict.json', {
    items: [
      verdictItem('A#0', 'difference', []),
      verdictItem('A#1', 'needs-signoff', ['VARIABLE_UNMODELED']),
      verdictItem('A#2', 'needs-signoff', ['PLACEMENT_SUBSTITUTED']),
      verdictItem('A#3', 'equal', []),
    ],
  });
  await write('extractions.json', {
    'src/A.tsx': {
      base: { elements: [] },
      head: {
        elements: [
          element('A#0', 'span', ['styles.a']),
          element('A#1', 'span', ['styles.dot'], {
            variables: [{ kind: 'unknown', name: 'device' }],
          }),
          element('A#2', 'SkillsIcon', ['styles.icon']),
          element('A#3', 'div', ['styles.box']),
        ],
      },
    },
  });
  await write('mutation.json', { passed: true });
  await write('calibration.json', []);
  await write('evidence.json', {
    'src/A.tsx|A#0': {
      declarations: {
        base: { 'styles.a': 'a: css`\n    color: black;\n    padding: 4px;\n  `' },
        head: { 'styles.a': "a: {\n    color: 'red',\n    padding: '4px',\n  }" },
      },
      elements: {
        base: [
          {
            bindings: [{ expr: 'styles.a', prop: 'className', spread: false }],
            literalProps: {},
            slots: ['styles.a'],
            tag: 'span',
          },
        ],
        head: [
          {
            bindings: [{ expr: 'stylex.props(styles.a)', prop: '...', spread: true }],
            literalProps: {},
            slots: ['styles.a'],
            tag: 'span',
          },
        ],
      },
    },
    'src/A.tsx|A#2': {
      declarations: {
        base: {
          'styles.icon': 'icon: css`\n    color: red;\n  `',
          'styles.row': 'row: css`\n    gap: 4px;\n  `',
        },
        head: { 'styles.icon': "icon: { color: 'red' }", 'styles.row': "row: { gap: '4px' }" },
      },
      elements: {
        head: [
          { bindings: [], literalProps: {}, slots: ['styles.icon'], tag: 'SkillsIcon' },
          { bindings: [], literalProps: {}, slots: ['styles.row'], tag: 'Flexbox' },
        ],
      },
    },
  });
  server = await startServer({ layoutComponents: ['Flexbox'], runDir });
});

afterAll(async () => {
  await server?.stop();
  await rm(root, { force: true, recursive: true });
});

const post = (body: unknown) =>
  fetch(`${server.url}/api/review`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

const queue = async () => (await (await fetch(`${server.url}/api/review`)).json()) as any;

describe('review API', () => {
  it('lists only items that need a person, with plain prompts and PR info', async () => {
    const payload = await queue();
    expect(payload.items.map((entry: any) => entry.key)).toEqual([
      'src/A.tsx|A#0',
      'src/A.tsx|A#1',
      'src/A.tsx|A#2',
    ]);
    const variable = payload.items.find((entry: any) => entry.key === 'src/A.tsx|A#1');
    expect(variable).toMatchObject({ canPass: true, state: 'todo' });
    expect(variable.ask).toContain('取决于 device');
    expect(variable.combos.map((combo: any) => combo.label)).toEqual(['online：否', 'online：是']);
    const difference = payload.items.find((entry: any) => entry.key === 'src/A.tsx|A#0');
    expect(difference.summary).toEqual(['文字颜色 black → red']);
    expect(difference.canPass).toBe(false);
    expect(difference.styles.blocks).toEqual([
      {
        rows: [
          {
            after: ['color: red'],
            before: ['color: black'],
            differs: true,
            label: 'color',
            oneSided: false,
          },
          {
            after: ['padding: 4px'],
            before: ['padding: 4px'],
            differs: false,
            label: 'padding',
            oneSided: false,
          },
        ],
        slot: 'a',
      },
    ]);
    expect(difference.styles.source.head['styles.a']).toContain("color: 'red'");
    expect(difference.styles.usage).toEqual({
      base: ['<span className={styles.a}>'],
      head: ['<span {...stylex.props(styles.a)}>'],
    });
    expect(variable.styles).toEqual({ blocks: [], source: {}, usage: {} });
    const placed = payload.items.find((entry: any) => entry.key === 'src/A.tsx|A#2');
    expect(placed.styles.blocks.map((block: any) => [block.slot, block.standIn])).toEqual([
      ['icon', 'SkillsIcon'],
      ['row', undefined],
    ]);
    expect(placed.standIns).toEqual({ head: ['SkillsIcon'] });
    expect(difference.standIns).toEqual({});
    expect(payload.items.find((entry: any) => entry.key === 'src/A.tsx|A#2').state).toBe(
      'waiting-agent',
    );
    expect(payload.pr).toMatchObject({ number: 21054 });
    expect(payload.counts).toMatchObject({ proven: 1, total: 4 });
  });

  it('describes any case for the case page and says whether it sits in the review queue', async () => {
    const view = async (key: string) =>
      (await fetch(`${server.url}/api/case/${encodeURIComponent(key)}/review`)).json() as any;
    const equal = await view('src/A.tsx|A#3');
    expect(equal.queued).toBe(false);
    expect(equal.conditions).toEqual(['light/1280/default', 'dark/1280/default']);
    expect(equal.item).toMatchObject({ canPass: false, category: 'equal', key: 'src/A.tsx|A#3' });
    expect(equal.item.combos).toHaveLength(1);
    const difference = await view('src/A.tsx|A#0');
    expect(difference.queued).toBe(true);
    expect(difference.item.summary).toEqual(['文字颜色 black → red']);
    const missing = await fetch(
      `${server.url}/api/case/${encodeURIComponent('src/A.tsx|Z#9')}/review`,
    );
    expect(missing.status).toBe(404);
  });

  it('records a pass in the records reviews', async () => {
    const response = await post({
      action: 'pass',
      key: 'src/A.tsx|A#1',
      note: '',
      reviewer: 'innei',
    });
    expect(response.status).toBe(200);
    expect((await queue()).items.find((entry: any) => entry.key === 'src/A.tsx|A#1').state).toBe(
      'passed',
    );
    const stored = JSON.parse(await readFile(path.join(root, 'reviews/src/A.tsx.json'), 'utf8'));
    expect(stored.passes[0]).toMatchObject({ key: 'src/A.tsx|A#1', reason: 'REVIEW_PASS' });
  });

  it('requires a note to send back an item without a rendered difference and refuses passes that are not allowed', async () => {
    expect((await post({ action: 'rework', key: 'src/A.tsx|A#1', note: '' })).status).toBe(400);
    expect((await post({ action: 'rework', key: 'src/A.tsx|A#2', note: ' ' })).status).toBe(400);
    const generated = await post({
      action: 'rework',
      key: 'src/A.tsx|A#0',
      note: '',
      reviewer: 'innei',
    });
    expect(generated.status).toBe(200);
    expect(
      (await generated.json()).items.find((entry: any) => entry.key === 'src/A.tsx|A#0').rework
        .note,
    ).toBe('不一样：文字颜色 black → red');
    expect((await post({ action: 'pass', key: 'src/A.tsx|A#0', note: '误报' })).status).toBe(409);
    expect((await post({ action: 'pass', key: 'src/A.tsx|A#2', note: '' })).status).toBe(409);
    expect(
      (
        await post({
          action: 'rework',
          key: 'src/A.tsx|A#0',
          note: '颜色变红了',
          reviewer: 'innei',
        })
      ).status,
    ).toBe(200);
    const payload = await queue();
    const reworked = payload.items.find((entry: any) => entry.key === 'src/A.tsx|A#0');
    expect(reworked.state).toBe('reworked');
    expect(reworked.rework.note).toBe('颜色变红了');
    expect(payload.verdict.reasons).toContain('rework open 1');
  });
});

describe('rework scope', () => {
  it('does not resolve or show a send-back that belongs to another PR', async () => {
    const file = path.join(root, 'reviews/src/A.tsx.json');
    const stored = JSON.parse(await readFile(file, 'utf8'));
    stored.reworks.push({
      at: '2026-11-05T00:00:00Z',
      base: 'x',
      elementSignature: 'div|styles.box',
      file: 'src/A.tsx',
      hash: 'other-hash',
      head: 'y',
      key: 'src/A.tsx|A#3',
      note: '别的 PR 的打回',
      pr: 99_999,
      reviewer: 'innei',
      runId: 'other-run',
    });
    await writeFile(file, JSON.stringify(stored));
    const payload = await queue();
    expect(payload.resolved.map((entry: any) => entry.key)).not.toContain('src/A.tsx|A#3');
    const after = JSON.parse(await readFile(file, 'utf8'));
    expect(after.reworks.find((entry: any) => entry.pr === 99_999).resolvedAt).toBeUndefined();
  });
});

describe('rework and annotate commands', () => {
  it('prints open reworks with the element and the reviewer note', async () => {
    const text = await reworkList(await loadRun(runDir));
    expect(text).toContain('#21054');
    expect(text).toContain('A#0');
    expect(text).toContain('颜色变红了');
  });

  it('lists agent-read items and stores notes bound to the current hash', async () => {
    const stored = await loadRun(runDir);
    const list = await annotateList(stored);
    expect(list.map((entry) => entry.key)).toEqual(['src/A.tsx|A#2']);
    expect(list[0]).toMatchObject({ component: 'SkillsIcon', hash: 'hash-A#2' });
    await applyNotes(stored, [
      { finding: 'className 落在根 svg 上', key: 'src/A.tsx|A#2', suggestion: 'pass' },
    ]);
    const item = (await queue()).items.find((entry: any) => entry.key === 'src/A.tsx|A#2');
    expect(item).toMatchObject({ canPass: true, state: 'todo' });
    expect(item.note.finding).toBe('className 落在根 svg 上');
  });
});
