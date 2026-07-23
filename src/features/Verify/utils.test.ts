import type { VerifyCheckItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { VerifyResultWithEvidence } from '@/services/verify';

import {
  buildCheckRows,
  countResults,
  extractUuid,
  isDraftUnconfirmed,
  itemBehavior,
  phaseFromStatus,
  renderableSurfaces,
  resolveRoundParam,
} from './utils';

const planItem = (id: string, overrides: Partial<VerifyCheckItem> = {}): VerifyCheckItem => ({
  id,
  index: 0,
  onFail: 'manual',
  required: true,
  title: `plan ${id}`,
  verifierConfig: {},
  verifierType: 'agent',
  ...overrides,
});

const result = (
  checkItemId: string,
  verdict: 'passed' | 'failed' | 'uncertain',
): VerifyResultWithEvidence =>
  ({
    checkItemId,
    evidence: [],
    id: `result-${checkItemId}`,
    verdict,
  }) as unknown as VerifyResultWithEvidence;

describe('phaseFromStatus', () => {
  it('maps rollup statuses to dock phases', () => {
    expect(phaseFromStatus('planned')).toBe('draft');
    expect(phaseFromStatus('verifying')).toBe('verifying');
    expect(phaseFromStatus('failed')).toBe('failed');
    // `errored` is a terminal, non-pass phase of its own — never `idle` (which
    // would drop the checker body and read as still-pending).
    expect(phaseFromStatus('errored')).toBe('errored');
    expect(phaseFromStatus('repairing')).toBe('repairing');
    expect(phaseFromStatus('passed')).toBe('passed');
    expect(phaseFromStatus('delivered')).toBe('passed');
    expect(phaseFromStatus(null)).toBe('idle');
    expect(phaseFromStatus('unverified')).toBe('idle');
  });
});

describe('isDraftUnconfirmed', () => {
  it('is true only for a planned, not-yet-confirmed plan', () => {
    expect(isDraftUnconfirmed('planned', null)).toBe(true);
    expect(isDraftUnconfirmed('planned', new Date())).toBe(false);
    expect(isDraftUnconfirmed('verifying', null)).toBe(false);
  });
});

describe('itemBehavior', () => {
  it('maps required → gate, optional → auto_improve', () => {
    expect(itemBehavior({ required: true })).toBe('gate');
    expect(itemBehavior({ required: false })).toBe('auto_improve');
  });
});

describe('countResults', () => {
  it('counts passed/failed by status or verdict', () => {
    expect(
      countResults([
        { status: 'passed', verdict: 'passed' } as any,
        { status: 'failed', verdict: 'failed' } as any,
        { status: 'skipped', verdict: null } as any,
      ]),
    ).toEqual({ failed: 1, passed: 1, total: 3 });
  });
});

describe('buildCheckRows', () => {
  it('keeps a planned check that never produced a result', () => {
    const rows = buildCheckRows(
      [planItem('a'), planItem('b'), planItem('c')],
      [result('a', 'passed'), result('c', 'passed')],
    );

    // The whole reason the plan is stored: `b` was promised and silently never
    // ran. Without the plan it would simply be absent, and a reader would see
    // "2/2 passed" with no way to know a third of the coverage vanished.
    const notExecuted = rows.filter((row) => row.state === 'not_executed');
    expect(notExecuted.map((row) => row.id)).toEqual(['b']);
    expect(rows).toHaveLength(3);
  });

  it('sorts unresolved first: failed → uncertain → never ran → passed', () => {
    const rows = buildCheckRows(
      [planItem('pass'), planItem('skip'), planItem('fail'), planItem('unsure')],
      [result('pass', 'passed'), result('fail', 'failed'), result('unsure', 'uncertain')],
    );

    expect(rows.map((row) => row.id)).toEqual(['fail', 'unsure', 'skip', 'pass']);
  });

  it('appends a result the plan never named rather than dropping it', () => {
    const rows = buildCheckRows(
      [planItem('planned')],
      [result('planned', 'passed'), result('discovered', 'failed')],
    );

    const discovered = rows.find((row) => row.id === 'discovered');
    expect(discovered?.state).toBe('failed');
    expect(discovered?.planItem).toBeUndefined();
  });

  it('degrades to results-only when the run has no plan', () => {
    const rows = buildCheckRows(null, [result('a', 'passed'), result('b', 'failed')]);

    expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
    expect(rows.every((row) => row.state !== 'not_executed')).toBe(true);
  });
});

describe('renderableSurfaces', () => {
  it('resolves known aliases and drops values that name no surface', () => {
    expect(
      renderableSurfaces([
        'electron',
        'cli',
        // The long tail history left behind: prose, runtime modes, test kinds.
        'Electron 打包版（app.isPackaged=true）',
        'unit',
      ] as any),
    ).toEqual(['desktop', 'cli']);
  });

  it('dedupes surfaces that collapse onto the same canonical value', () => {
    expect(renderableSurfaces(['electron', 'desktop'] as any)).toEqual(['desktop']);
  });

  it('returns nothing for an empty or missing list', () => {
    expect(renderableSurfaces([])).toEqual([]);
    expect(renderableSurfaces(undefined)).toEqual([]);
  });
});

describe('resolveRoundParam', () => {
  const rounds = [
    { run: { roundIndex: 1 } },
    { run: { roundIndex: 2 } },
    { run: { roundIndex: 3 } },
  ];

  it('resolves ?r= to the round with that index', () => {
    expect(resolveRoundParam(rounds, '2')).toBe(rounds[1]);
  });

  it('ignores an absent or non-integer param', () => {
    expect(resolveRoundParam(rounds, null)).toBeNull();
    expect(resolveRoundParam(rounds, '')).toBeNull();
    expect(resolveRoundParam(rounds, 'abc')).toBeNull();
    expect(resolveRoundParam(rounds, '2.5')).toBeNull();
    expect(resolveRoundParam(rounds, '-1')).toBeNull();
  });

  it('ignores an index the chain never reached', () => {
    expect(resolveRoundParam(rounds, '7')).toBeNull();
  });

  it('skips legacy rounds whose index was never stamped', () => {
    expect(resolveRoundParam([{ run: { roundIndex: null } }], '0')).toBeNull();
  });
});

describe('extractUuid', () => {
  const id = 'e7545637-0e1a-4d7b-8922-efc9f13e4c74';

  it('salvages the leading uuid when an autolinker glued trailing punctuation on', () => {
    expect(extractUuid(`${id}（本轮`)).toBe(id);
    expect(extractUuid(`${id})`)).toBe(id);
  });

  it('passes a clean uuid and non-uuid params through unchanged', () => {
    expect(extractUuid(id)).toBe(id);
    expect(extractUuid('definitely-not-a-uuid')).toBe('definitely-not-a-uuid');
    expect(extractUuid(undefined)).toBeUndefined();
  });
});
