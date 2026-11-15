import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StoredRun } from './api';
import { caseReview } from './review';

const FILE = 'src/T.tsx';

const element = (id: string, tag: string, slots: string[], parent?: string) => ({
  bindings: slots.length ? [{ expr: slots[0], prop: 'className', spread: false }] : [],
  flags: [],
  id,
  literalProps: {},
  owner: 'TableRenderer',
  ...(parent ? { parent } : {}),
  slots,
  tag,
  variables: [],
});

const baseTable = `table: css\`
    border-collapse: collapse;

    th,
    td {
      padding-block: 8px;
    }

    th {
      font-size: 11px;
    }
  \``;

const headTexts = {
  'styles.cell': `cell: { paddingBlock: '8px' }`,
  'styles.table': `table: { borderCollapse: 'collapse' }`,
  'styles.td': `td: { fontSize: '12px' }`,
  'styles.th': `th: { fontSize: '11px' }`,
};

let records: string;
let stored: StoredRun;

beforeAll(async () => {
  records = await mkdtemp(path.join(tmpdir(), 'style-eq-moved-'));
  stored = {
    calibration: [],
    evidence: {
      [`${FILE}|T#1`]: {
        declarations: {
          base: { 'styles.table': baseTable },
          head: { 'styles.table': headTexts['styles.table'] },
        },
      },
      [`${FILE}|T#2`]: {
        declarations: {
          head: { 'styles.cell': headTexts['styles.cell'], 'styles.td': headTexts['styles.td'] },
        },
      },
      [`${FILE}|unpaired:head:T#3`]: {
        counterpart: { base: '<th>' },
        declarations: {
          head: { 'styles.cell': headTexts['styles.cell'], 'styles.th': headTexts['styles.th'] },
        },
      },
    },
    extractions: {
      [FILE]: {
        base: { elements: [element('T#1', 'table', ['styles.table'])] },
        head: {
          elements: [
            element('T#1', 'table', ['styles.table']),
            element('T#2', 'td', ['styles.cell', 'styles.td'], 'T#1'),
            element('T#3', 'th', ['styles.cell', 'styles.th'], 'T#1'),
          ],
        },
      },
    },
    items: [
      {
        category: 'unpaired',
        file: FILE,
        flags: ['UNPAIRED'],
        hash: 'h3',
        key: `${FILE}|unpaired:head:T#3`,
      },
      {
        category: 'needs-signoff',
        file: FILE,
        flags: ['INNER_TARGET'],
        hash: 'h1',
        key: `${FILE}|T#1`,
      },
    ],
    mutation: { passed: true },
    plans: [],
    recordsDir: records,
    results: {
      cases: [
        {
          category: 'needs-signoff',
          key: `${FILE}|T#1`,
          plan: {
            combos: [{}],
            elementIds: { base: 'T#1', head: 'T#1' },
            file: FILE,
            flags: ['INNER_TARGET'],
            key: `${FILE}|T#1`,
            variables: [],
          },
          result: { comboDifferences: [], differingConditions: [], errors: [], rootCauses: [] },
        },
      ],
    },
    run: { base: 'a'.repeat(40), head: 'b'.repeat(40), runId: 'run-moved' },
  } as unknown as StoredRun;
});

afterAll(() => rm(records, { force: true, recursive: true }));

describe('caseReview with rules moved onto child elements', () => {
  it('lines up a base descendant rule with the child slot that now carries it', async () => {
    const { item } = await caseReview(stored, `${FILE}|T#1`);
    const [block] = item.styles.blocks;

    expect(block.rows.find((row) => row.label === 'th, td padding')).toMatchObject({
      after: ['padding-block: 8px'],
      movedTo: ['<td> <th> · styles.cell'],
      oneSided: false,
    });
    expect(block.rows.find((row) => row.label === 'th font-size')?.after).toEqual([
      'font-size: 11px',
    ]);
  });

  it('lists the child slots under the base slot for the source view', async () => {
    const { item } = await caseReview(stored, `${FILE}|T#1`);

    expect(item.styles.moved['styles.table']).toEqual([
      {
        selectors: ['th, td'],
        slot: 'styles.cell',
        tags: ['td', 'th'],
        text: headTexts['styles.cell'],
      },
      { selectors: ['th'], slot: 'styles.th', tags: ['th'], text: headTexts['styles.th'] },
    ]);
  });

  it('shows the unstyled same-position element on the side that has no class', async () => {
    const { item } = await caseReview(stored, `${FILE}|unpaired:head:T#3`);

    expect(item.styles.usage.base).toEqual(['<th>']);
    expect(item.styles.counterpart).toBe('base');
  });
});
