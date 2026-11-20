import { describe, expect, it } from 'vitest';

import { buildTree, conditionColumns, fileMatrix, overviewRows, type ReportCase } from './data';

const entry = (
  key: string,
  category: ReportCase['category'],
  differing: string[] = [],
  flags: string[] = [],
): ReportCase => ({
  category,
  key,
  plan: { file: key.split('|')[0], flags },
  result: { differingConditions: differing, gaps: [], rootCauses: [] },
});

const cases = [
  entry('src/a/Controls.tsx|A#0', 'difference', ['light/375/default']),
  entry(
    'src/a/Controls.tsx|A#1',
    'difference',
    ['light/375/default', 'dark/375/default'],
    ['CROSS_COMPONENT'],
  ),
  entry('src/a/Controls.tsx|A#2', 'equal'),
  entry('src/b/List.tsx|L#0', 'needs-signoff', [], ['PLACEMENT_SUBSTITUTED']),
  entry('src/b/Item.tsx|I#0', 'equal'),
];

describe('buildTree', () => {
  it('groups files by directory with their worst status and counts', () => {
    expect(
      buildTree(cases, [{ file: 'src/b/List.tsx', key: 'src/b/List.tsx|unpaired:base:L#9' }]),
    ).toEqual([
      {
        directory: 'src/a',
        files: [
          {
            file: 'src/a/Controls.tsx',
            name: 'Controls.tsx',
            open: 2,
            status: 'difference',
            total: 3,
          },
        ],
      },
      {
        directory: 'src/b',
        files: [
          { file: 'src/b/Item.tsx', name: 'Item.tsx', open: 0, status: 'equal', total: 1 },
          { file: 'src/b/List.tsx', name: 'List.tsx', open: 2, status: 'needs-signoff', total: 2 },
        ],
      },
    ]);
  });
});

describe('conditionColumns', () => {
  it('orders columns by theme, then width, then state, with variants last', () => {
    expect(
      conditionColumns([
        'dark/375/default',
        'light/1280/default',
        'light/375/hover-chain',
        'light/375/default',
        'light/1280/default/rtl',
      ]),
    ).toEqual([
      {
        label: 'light/375/default',
        state: 'default',
        theme: 'light',
        variant: undefined,
        width: 375,
      },
      {
        label: 'light/375/hover-chain',
        state: 'hover-chain',
        theme: 'light',
        variant: undefined,
        width: 375,
      },
      {
        label: 'light/1280/default',
        state: 'default',
        theme: 'light',
        variant: undefined,
        width: 1280,
      },
      {
        label: 'light/1280/default/rtl',
        state: 'default',
        theme: 'light',
        variant: 'rtl',
        width: 1280,
      },
      {
        label: 'dark/375/default',
        state: 'default',
        theme: 'dark',
        variant: undefined,
        width: 375,
      },
    ]);
  });
});

describe('fileMatrix', () => {
  it('counts differing cases per condition and tells unflagged from flagged differences', () => {
    const columns = conditionColumns([
      'light/375/default',
      'dark/375/default',
      'light/1280/default',
    ]);
    expect(fileMatrix(cases.slice(0, 3), columns)).toEqual([
      { count: 2, label: 'light/375/default', status: 'difference' },
      { count: 0, label: 'light/1280/default', status: 'equal' },
      { count: 1, label: 'dark/375/default', status: 'flagged-difference' },
    ]);
    expect(
      fileMatrix([entry('x.tsx|X#0', 'blocking')], columns).map((cell) => cell.status),
    ).toEqual(['unknown', 'unknown', 'unknown']);
  });
});

describe('overviewRows', () => {
  it('lists files with open cases first, most open first, and folds fully equal files', () => {
    const columns = conditionColumns(['light/375/default']);
    const { equal, open } = overviewRows(cases, columns);
    expect(open.map((row) => [row.file, row.open])).toEqual([
      ['src/a/Controls.tsx', 2],
      ['src/b/List.tsx', 1],
    ]);
    expect(open[0].matrix.map((cell) => cell.status)).toEqual(['difference']);
    expect(equal.map((row) => row.file)).toEqual(['src/b/Item.tsx']);
  });
});
