// @vitest-environment node
import type { VerifyCheckItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AcceptanceItem,
  VerifyCheckResultItem,
  VerifyRunItem,
} from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

import {
  collectCheckIds,
  countLogicalChecks,
  mergeAcceptanceRounds,
  planCheckIdRemap,
  remapPlanItem,
} from '../acceptanceMerge';

const mocks = vi.hoisted(() => ({
  acceptanceDelete: vi.fn(),
  acceptanceUpdate: vi.fn(),
  attachToAcceptance: vi.fn(),
  listByAcceptance: vi.fn(),
  listByRuns: vi.fn(),
  resultUpdate: vi.fn(),
  runUpdate: vi.fn(),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    attachToAcceptance: mocks.attachToAcceptance,
    listByAcceptance: mocks.listByAcceptance,
    update: mocks.runUpdate,
  })),
}));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(() => ({
    listByRuns: mocks.listByRuns,
    update: mocks.resultUpdate,
  })),
}));

vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn(() => ({
    delete: mocks.acceptanceDelete,
    update: mocks.acceptanceUpdate,
  })),
}));

const planItem = (id: string, overrides: Partial<VerifyCheckItem> = {}): VerifyCheckItem => ({
  id,
  index: 0,
  onFail: 'manual',
  required: true,
  title: `check ${id}`,
  verifierConfig: {},
  verifierType: 'agent',
  ...overrides,
});

const run = (id: string, roundIndex: number, plan: VerifyCheckItem[]): VerifyRunItem =>
  ({ id, plan, roundIndex }) as VerifyRunItem;

const result = (id: string, verifyRunId: string, checkItemId: string): VerifyCheckResultItem =>
  ({ checkItemId, id, verifyRunId }) as VerifyCheckResultItem;

const acceptance = (id: string, overrides: Partial<AcceptanceItem> = {}): AcceptanceItem =>
  ({ config: {}, id, status: 'delivered', visibility: 'private', ...overrides }) as AcceptanceItem;

const SOURCE_ID = '11111111-2222-3333-4444-555555555555';
const TARGET_ID = '99999999-8888-7777-6666-555555555555';

/** How many rounds the unscoped integrity count sees still chained to the source. */
let leftBehindRounds = 0;

/**
 * `db.transaction(fn)` runs its body inline — the models are mocked, so the only
 * real query in the body is the unscoped left-behind count.
 */
const fakeDb = {
  transaction: (fn: (tx: unknown) => unknown) =>
    fn({
      select: () => ({
        from: () => ({ where: async () => [{ value: leftBehindRounds }] }),
      }),
    }),
} as unknown as LobeChatDatabase;

const mergeWith = (source: AcceptanceItem, target: AcceptanceItem) =>
  mergeAcceptanceRounds({ db: fakeDb, source, target, userId: 'user-1' });

beforeEach(() => {
  vi.clearAllMocks();
  leftBehindRounds = 0;
  mocks.listByAcceptance.mockResolvedValue([]);
  mocks.listByRuns.mockResolvedValue([]);
  mocks.attachToAcceptance.mockResolvedValue({});
});

describe('planCheckIdRemap', () => {
  it('re-keys only the ids the target already uses', () => {
    const remap = planCheckIdRemap(['case-1', 'case-2'], new Set(['case-1']), 'abcd1234');

    expect(remap.get('case-1')).toBe('case-1~abcd1234');
    expect(remap.has('case-2')).toBe(false);
  });

  it('keeps generating until the replacement is free on both sides', () => {
    const remap = planCheckIdRemap(
      ['case-1', 'case-1~abcd1234'],
      new Set(['case-1', 'case-1~abcd1234']),
      'abcd1234',
    );

    // The obvious replacement is itself a source id, so it must not be reused.
    expect(remap.get('case-1')).toBe('case-1~abcd1234-2');
    expect(remap.get('case-1~abcd1234')).toBe('case-1~abcd1234~abcd1234');
  });
});

describe('collectCheckIds', () => {
  it('collects plan ids, their logical criterion ids and result-only ids', () => {
    const ids = collectCheckIds(
      [run('run-1', 1, [planItem('plan-1', { sourceCriterionId: 'criterion-a' })])],
      [result('res-1', 'run-1', 'ingested-only')],
    );

    expect([...ids].sort()).toEqual(['criterion-a', 'ingested-only', 'plan-1']);
  });
});

describe('countLogicalChecks', () => {
  it('counts one check once even when it carries a separate criterion id', () => {
    // `collectCheckIds` holds both ids for collision purposes — the user-facing
    // count must not read that as two checks.
    const runs = [run('run-1', 1, [planItem('plan-1', { sourceCriterionId: 'criterion-a' })])];

    expect(collectCheckIds(runs, []).size).toBe(2);
    expect(countLogicalChecks(runs, [])).toBe(1);
  });

  it('does not count a generation folded away by supersedes', () => {
    const runs = [
      run('run-1', 1, [planItem('old')]),
      run('run-2', 2, [planItem('new', { supersedes: ['old'] })]),
    ];

    expect(countLogicalChecks(runs, [])).toBe(1);
  });

  it('counts a result that names an item no plan carries', () => {
    expect(
      countLogicalChecks(
        [run('run-1', 1, [planItem('planned')])],
        [result('res-1', 'run-1', 'ingested-only')],
      ),
    ).toBe(2);
  });
});

describe('remapPlanItem', () => {
  it('rewrites the item id, its criterion id and its supersedes references', () => {
    const remap = new Map([
      ['a', 'a~m'],
      ['old', 'old~m'],
      ['crit', 'crit~m'],
    ]);

    expect(
      remapPlanItem(
        planItem('a', { sourceCriterionId: 'crit', supersedes: ['old', 'untouched'] }),
        remap,
      ),
    ).toMatchObject({
      id: 'a~m',
      sourceCriterionId: 'crit~m',
      supersedes: ['old~m', 'untouched'],
    });
  });
});

describe('mergeAcceptanceRounds', () => {
  it('re-chains every source round onto the target in order, then drops the source', async () => {
    const sourceRuns = [run('run-a', 1, [planItem('s1')]), run('run-b', 2, [planItem('s2')])];
    mocks.listByAcceptance.mockImplementation(async (id: string) =>
      id === SOURCE_ID ? sourceRuns : [run('run-t', 1, [planItem('t1')])],
    );

    const summary = await mergeWith(acceptance(SOURCE_ID), acceptance(TARGET_ID));

    expect(mocks.attachToAcceptance.mock.calls).toEqual([
      ['run-a', TARGET_ID, 'private'],
      ['run-b', TARGET_ID, 'private'],
    ]);
    expect(mocks.acceptanceDelete).toHaveBeenCalledWith(SOURCE_ID);
    expect(summary).toMatchObject({ movedChecks: 2, movedRounds: 2, rekeyedChecks: 0 });
  });

  it('reports the logical check count, not the raw identifier set', async () => {
    mocks.listByAcceptance.mockImplementation(async (id: string) =>
      id === SOURCE_ID
        ? [run('run-a', 1, [planItem('plan-1', { sourceCriterionId: 'criterion-a' })])]
        : [],
    );

    const summary = await mergeWith(acceptance(SOURCE_ID), acceptance(TARGET_ID));

    // One check that happens to speak two ids is still one moved check.
    expect(summary.movedChecks).toBe(1);
  });

  it('re-keys colliding check ids on both the plan and its results', async () => {
    const sourceRun = run('run-a', 1, [planItem('case-1'), planItem('case-9')]);
    const targetRun = run('run-t', 1, [planItem('case-1')]);
    mocks.listByAcceptance.mockImplementation(async (id: string) =>
      id === SOURCE_ID ? [sourceRun] : [targetRun],
    );
    mocks.listByRuns.mockImplementation(async (runIds: string[]) =>
      runIds.includes('run-a')
        ? [result('res-1', 'run-a', 'case-1'), result('res-9', 'run-a', 'case-9')]
        : [result('res-t', 'run-t', 'case-1')],
    );

    const summary = await mergeWith(acceptance(SOURCE_ID), acceptance(TARGET_ID));

    const salt = SOURCE_ID.slice(0, 8);
    expect(mocks.runUpdate).toHaveBeenCalledWith('run-a', {
      plan: [
        expect.objectContaining({ id: `case-1~${salt}` }),
        expect.objectContaining({ id: 'case-9' }),
      ],
    });
    // Only the colliding result is rewritten — `case-9` keeps its wording.
    expect(mocks.resultUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.resultUpdate).toHaveBeenCalledWith('res-1', { checkItemId: `case-1~${salt}` });
    expect(summary.rekeyedChecks).toBe(1);
  });

  it('leaves the plan untouched when nothing collides', async () => {
    mocks.listByAcceptance.mockImplementation(async (id: string) =>
      id === SOURCE_ID ? [run('run-a', 1, [planItem('s1')])] : [run('run-t', 1, [planItem('t1')])],
    );

    await mergeWith(acceptance(SOURCE_ID), acceptance(TARGET_ID));

    expect(mocks.runUpdate).not.toHaveBeenCalled();
    expect(mocks.resultUpdate).not.toHaveBeenCalled();
  });

  it('carries the standing checklist over, deduped by name, and adopts a missing goal', async () => {
    const source = acceptance(SOURCE_ID, {
      config: {
        checklist: [
          { id: 'c1', name: 'Login works' },
          { id: 'c2', name: ' shared item ' },
        ],
      },
      requirement: 'Ship the login flow',
    });
    const target = acceptance(TARGET_ID, {
      config: { checklist: [{ id: 't1', name: 'Shared Item' }] },
      requirement: null,
    });

    await mergeWith(source, target);

    expect(mocks.acceptanceUpdate).toHaveBeenCalledWith(TARGET_ID, {
      config: {
        checklist: [
          { id: 't1', name: 'Shared Item' },
          { id: 'c1', name: 'Login works' },
        ],
      },
      requirement: 'Ship the login flow',
    });
  });

  it('refuses to drop the source while a round the caller cannot see is still chained', async () => {
    mocks.listByAcceptance.mockImplementation(async (id: string) =>
      id === SOURCE_ID ? [run('run-a', 1, [planItem('s1')])] : [],
    );
    leftBehindRounds = 1;

    await expect(mergeWith(acceptance(SOURCE_ID), acceptance(TARGET_ID))).rejects.toThrow(
      /not visible to you/,
    );
    expect(mocks.acceptanceDelete).not.toHaveBeenCalled();
  });

  it('keeps the target goal when it already has one', async () => {
    await mergeWith(
      acceptance(SOURCE_ID, { requirement: 'source goal' }),
      acceptance(TARGET_ID, { requirement: 'target goal' }),
    );

    expect(mocks.acceptanceUpdate).not.toHaveBeenCalled();
  });
});
