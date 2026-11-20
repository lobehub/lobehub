import { describe, expect, it } from 'vitest';

import { decideVerdict, signCases, type VerdictItem } from './index';

const item = (
  key: string,
  category: VerdictItem['category'],
  flags: string[] = [],
): VerdictItem => ({
  category,
  file: 'src/A.tsx',
  flags,
  hash: `hash-${key}`,
  key,
});

const items = [
  item('src/A.tsx|A#0', 'equal'),
  item('src/A.tsx|A#1', 'needs-signoff', ['PLACEMENT_SUBSTITUTED']),
  item('src/A.tsx|A#2', 'needs-signoff', ['PLACEMENT_SUBSTITUTED']),
  item('src/A.tsx|A#3', 'difference', ['CROSS_COMPONENT']),
  item('src/A.tsx|unpaired:base:A#9', 'unpaired'),
];

const sign = (keys: string[], reason: string, list = items) =>
  signCases({
    items: list,
    keys,
    note: 'checked',
    now: '2026-11-04T00:00:00.000Z',
    reason,
    signer: 'innei',
  });

const allSigned = () => [
  ...sign(['src/A.tsx|A#1', 'src/A.tsx|A#2'], 'PLACEMENT_SUBSTITUTED'),
  ...sign(['src/A.tsx|A#3'], 'TOOL_FALSE_POSITIVE'),
  ...sign(['src/A.tsx|unpaired:base:A#9'], 'UNPAIRED'),
];

const verdict = (overrides: Partial<Parameters<typeof decideVerdict>[0]> = {}) =>
  decideVerdict({
    calibration: [{ status: 'agree' }],
    items,
    mutation: { passed: true },
    signoffs: new Map(allSigned().map((record) => [record.key, record])),
    ...overrides,
  });

describe('signCases', () => {
  it('refuses to sign an unflagged difference', () => {
    expect(() =>
      sign(['src/A.tsx|B#0'], 'TOOL_FALSE_POSITIVE', [item('src/A.tsx|B#0', 'difference')]),
    ).toThrow('UNFLAGGED_DIFFERENCE');
  });

  it('only signs a flagged difference as a tool false positive', () => {
    expect(() => sign(['src/A.tsx|A#3'], 'CROSS_COMPONENT')).toThrow('REASON_NOT_ALLOWED');
  });

  it('signs a batch only within one reason group and unpaired elements one at a time', () => {
    expect(() => sign(['src/A.tsx|A#1', 'src/A.tsx|A#3'], 'PLACEMENT_SUBSTITUTED')).toThrow(
      'REASON_NOT_ALLOWED',
    );
    expect(() =>
      sign(['src/A.tsx|unpaired:base:A#9', 'src/A.tsx|unpaired:head:A#8'], 'UNPAIRED', [
        ...items,
        item('src/A.tsx|unpaired:head:A#8', 'unpaired'),
      ]),
    ).toThrow('UNPAIRED_ONE_BY_ONE');
    expect(
      sign(['src/A.tsx|A#1', 'src/A.tsx|A#2'], 'PLACEMENT_SUBSTITUTED').map(
        (record) => record.hash,
      ),
    ).toEqual(['hash-src/A.tsx|A#1', 'hash-src/A.tsx|A#2']);
  });
});

describe('decideVerdict', () => {
  it('is mergeable only when every term holds', () => {
    expect(verdict()).toMatchObject({ mergeable: true, reasons: [] });
    expect(verdict({ mutation: { passed: false } }).reasons).toEqual(['mutation not fully caught']);
    expect(verdict({ calibration: [{ status: 'mismatch' }] }).reasons).toEqual([
      'calibration mismatch 1',
    ]);
    expect(verdict({ items: [...items, item('src/A.tsx|C#0', 'blocking')] }).reasons).toEqual([
      'blocking 1',
    ]);
    expect(verdict({ items: [...items, item('src/A.tsx|D#0', 'difference')] }).reasons).toEqual([
      'difference 1',
    ]);
    expect(verdict({ signoffs: new Map() }).mergeable).toBe(false);
  });

  it('refuses a run whose page held selectors it could not evaluate', () => {
    const result = decideVerdict({
      calibration: [],
      items: [],
      mutation: { passed: true },
      signoffs: new Map(),
      unparsedSelectors: 2,
    });
    expect(result).toMatchObject({ mergeable: false, reasons: ['selector unparsed 2'] });
  });

  it('counts unsigned unpaired elements apart from unsigned cases', () => {
    expect(verdict({ signoffs: new Map() }).reasons).toEqual([
      'difference 1',
      'needs sign-off 2',
      'unpaired 1',
    ]);
  });

  it('treats a sign-off whose hash no longer matches as stale', () => {
    const changed = items.map((entry) =>
      entry.key === 'src/A.tsx|A#1' ? { ...entry, hash: 'hash-after-source-change' } : entry,
    );
    const result = verdict({ items: changed });
    expect(result.mergeable).toBe(false);
    expect(result.reasons).toEqual(['needs sign-off 1 (1 stale)']);
    expect(result.items.find((entry) => entry.key === 'src/A.tsx|A#1')?.signoff).toBe('stale');
  });
});

describe('sign-off coverage', () => {
  const twoFlags = [
    item('src/A.tsx|C#0', 'needs-signoff', ['CROSS_COMPONENT', 'PLACEMENT_SUBSTITUTED']),
  ];
  const state = (records: ReturnType<typeof sign>) =>
    decideVerdict({
      calibration: [],
      items: twoFlags,
      mutation: { passed: true },
      signoffs: new Map(records.map((record) => [record.key, record])),
    }).items[0];

  it('stays unsigned until every flag on the case has been signed', () => {
    const first = sign(['src/A.tsx|C#0'], 'PLACEMENT_SUBSTITUTED', twoFlags);
    expect(state(first)).toMatchObject({
      signedReasons: ['PLACEMENT_SUBSTITUTED'],
      signoff: 'missing',
    });
  });

  it('adds a reason to the existing record when the hash still matches', () => {
    const first = sign(['src/A.tsx|C#0'], 'PLACEMENT_SUBSTITUTED', twoFlags);
    const second = signCases({
      existing: new Map(first.map((record) => [record.key, record])),
      items: twoFlags,
      keys: ['src/A.tsx|C#0'],
      note: 'checked the outer row',
      now: '2026-11-04T01:00:00.000Z',
      reason: 'CROSS_COMPONENT',
      signer: 'innei',
    });
    expect(second[0].reasons).toEqual(['CROSS_COMPONENT', 'PLACEMENT_SUBSTITUTED']);
    expect(state(second).signoff).toBe('valid');
  });
});
