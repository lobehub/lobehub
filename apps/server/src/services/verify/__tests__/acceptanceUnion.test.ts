// @vitest-environment node
import type { VerifyCheckItem } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VerifyCheckResultItem, VerifyRunItem } from '@/database/schemas/verify';

import {
  AcceptanceService,
  buildAcceptanceCheckUnion,
  buildCheckReviewOverlay,
} from '../acceptanceService';

// Union/grouping checks never execute tasks; keep that external runtime out of this suite.
vi.mock('@/server/services/task', () => ({ TaskService: class {} }));
afterEach(() => vi.restoreAllMocks());

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

const result = (
  checkItemId: string,
  verdict: 'passed' | 'failed' | 'uncertain',
  overrides: Partial<VerifyCheckResultItem> = {},
): VerifyCheckResultItem =>
  ({
    checkItemId,
    id: `res-${checkItemId}-${verdict}`,
    required: true,
    status: verdict,
    verdict,
    ...overrides,
  }) as VerifyCheckResultItem;

describe('buildAcceptanceCheckUnion', () => {
  it('rejects unknown checks and ambiguous group membership before storing organization', async () => {
    const service = new AcceptanceService({} as never, 'owner');
    vi.spyOn(service.acceptanceModel, 'findById').mockResolvedValue({ id: 'acceptance' } as never);
    vi.spyOn(service, 'loadRounds').mockResolvedValue({
      runs: [run('r1', 1, [planItem('known')])],
      results: [],
      evidence: [],
      reports: [],
    });
    const save = vi
      .spyOn(service.acceptanceModel, 'setCheckGroups')
      .mockResolvedValue({ groups: [], version: 1 });
    await expect(
      service.regroupChecks('acceptance', [{ title: 'A', checkItemIds: ['foreign'] }], 0),
    ).rejects.toThrow('Unknown check item');
    await expect(
      service.regroupChecks(
        'acceptance',
        [
          { title: 'A', checkItemIds: ['known'] },
          { title: 'B', checkItemIds: ['known'] },
        ],
        0,
      ),
    ).rejects.toThrow('multiple groups');
    await expect(
      service.regroupChecks('acceptance', [{ title: ' ', checkItemIds: ['known'] }], 0),
    ).rejects.toThrow('unique, non-empty');
    expect(save).not.toHaveBeenCalled();
    await service.regroupChecks(
      'acceptance',
      [{ title: ' Reassignment ', checkItemIds: ['known'] }],
      0,
    );
    expect(save).toHaveBeenCalledWith(
      'acceptance',
      [{ title: 'Reassignment', checkItemIds: ['known'] }],
      0,
    );
  });

  it('regroups existing flow checks without changing identity, verdict, review or history', () => {
    const items = ['handoff', 'resume'].map((id) =>
      planItem(id, {
        category: 'Whole PR',
        sourceCriterionId: 'shared-asset',
        sourceFlowNode: { flowId: 'flow', nodeId: id },
      }),
    );
    const passed = result('handoff', 'passed', {
      userDecision: 'accepted',
      userDecisionDetail: { decidedAt: '2026-09-08T00:00:00Z' },
    });
    const rounds = [{ run: run('r1', 1, items), results: [passed] }];
    const before = buildAcceptanceCheckUnion(rounds);
    const grouped = buildAcceptanceCheckUnion(rounds, [
      { title: 'Continuation', checkItemIds: ['resume'] },
      { title: 'Reassignment', checkItemIds: ['handoff'] },
    ]);
    expect(grouped.map((row) => [row.id, row.category, row.seq])).toEqual([
      ['resume', 'Continuation', 2],
      ['handoff', 'Reassignment', 1],
    ]);
    for (const row of grouped) {
      const original = before.find((item) => item.id === row.id)!;
      expect({ ...row, category: original.category }).toEqual(original);
      expect(buildCheckReviewOverlay(row, new Map([[passed.id, passed]]), 1)).toEqual(
        buildCheckReviewOverlay(original, new Map([[passed.id, passed]]), 1),
      );
    }
    expect(items.every((item) => item.category === 'Whole PR')).toBe(true);
    expect(buildAcceptanceCheckUnion(rounds, [])).toEqual(before);
  });

  it('leaves newly introduced checks and repeated asset occurrences ungrouped until assigned', () => {
    const rows = buildAcceptanceCheckUnion(
      [
        {
          run: run(
            'r1',
            1,
            ['a', 'b'].map((id) =>
              planItem(id, {
                category: 'Original',
                sourceCriterionId: 'shared',
                sourceFlowNode: { flowId: 'f', nodeId: id },
              }),
            ),
          ),
          results: [],
        },
      ],
      [{ title: 'Moved', checkItemIds: ['a'] }],
    );
    expect(rows.map((row) => [row.id, row.category])).toEqual([
      ['a', 'Moved'],
      ['b', 'Original'],
    ]);
  });

  it('resets a flow check for a new run while keeping earlier evidence and review in history', () => {
    const item = planItem('node', {
      sourceFlowNode: { flowId: 'flow', nodeId: 'n1' },
    });
    const previous = result('node', 'passed', {
      userDecision: 'accepted',
      userDecisionDetail: { decidedAt: '2026-09-08T00:00:00Z' },
    });
    const [check] = buildAcceptanceCheckUnion([
      { run: run('r1', 1, [item]), results: [previous] },
      { run: run('r2', 2, [item]), results: [] },
    ]);
    expect(check.state).toBe('not_executed');
    expect(check.result).toBeUndefined();
    expect(check.timeline).toHaveLength(1);
    expect(
      buildCheckReviewOverlay(check, new Map([[previous.id, previous]]), 2).userReview?.stale,
    ).toBe(true);
  });

  it('takes each item final verdict from its latest round and keeps the trail', () => {
    const plan = [planItem('badge')];
    const rows = buildAcceptanceCheckUnion([
      { results: [result('badge', 'failed')], run: run('r1', 1, plan) },
      { results: [result('badge', 'failed')], run: run('r2', 2, plan) },
      { results: [result('badge', 'passed')], run: run('r3', 3, plan) },
    ]);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.state).toBe('passed');
    expect(row.fixed).toBe(true);
    expect(row.resultRound).toBe(3);
    expect(row.introducedAtRound).toBe(1);
    expect(row.history.map((h) => `${h.roundIndex}:${h.state}`)).toEqual([
      '1:failed',
      '2:failed',
      '3:passed',
    ]);
  });

  it('keeps flow positions and branches separate when they reuse one asset', () => {
    const plan = ['entry', 'branch-a', 'branch-b'].map((id) =>
      planItem(id, {
        sourceCriterionId: 'shared-asset',
        sourceFlowNode: { flowId: 'flow', nodeId: 'node', incomingEdgeId: id },
      }),
    );
    const rows = buildAcceptanceCheckUnion([
      { results: [result('entry', 'passed')], run: run('r1', 1, plan) },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === 'entry')?.state).toBe('passed');
    expect(rows.filter((row) => row.result)).toHaveLength(1);
  });

  it('joins different run-local item ids through their stable source criterion', () => {
    const rows = buildAcceptanceCheckUnion([
      {
        results: [result('run-1-item', 'failed')],
        run: run('r1', 1, [
          planItem('run-1-item', { sourceCriterionId: 'criterion-1', title: 'Stable check' }),
        ]),
      },
      {
        results: [result('run-2-item', 'passed')],
        run: run('r2', 2, [
          planItem('run-2-item', { sourceCriterionId: 'criterion-1', title: 'Stable check' }),
        ]),
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('criterion-1');
    expect(rows[0].state).toBe('passed');
    expect(rows[0].fixed).toBe(true);
    expect(rows[0].history.map((entry) => entry.roundIndex)).toEqual([1, 2]);
  });

  it('marks an item planned later but never re-run as carried forward', () => {
    const plan = [planItem('prefs')];
    const rows = buildAcceptanceCheckUnion([
      { results: [result('prefs', 'passed')], run: run('r1', 1, plan) },
      { results: [], run: run('r2', 2, plan) },
    ]);

    expect(rows[0].state).toBe('passed');
    expect(rows[0].carriedFromRound).toBe(1);
    expect(rows[0].fixed).toBe(false);
  });

  it('keeps a planned-but-never-executed item visible as not_executed', () => {
    const rows = buildAcceptanceCheckUnion([
      { results: [], run: run('r1', 1, [planItem('dark-contrast')]) },
    ]);

    expect(rows[0].state).toBe('not_executed');
    expect(rows[0].history).toEqual([]);
    expect(rows[0].carriedFromRound).toBeUndefined();
  });

  it('numbers rows by first appearance, stable as rounds accrue', () => {
    const rows1 = buildAcceptanceCheckUnion([
      { results: [], run: run('r1', 1, [planItem('a'), planItem('b')]) },
    ]);
    expect(rows1.map((r) => `${r.id}:C${r.seq}`)).toEqual(['a:C1', 'b:C2']);

    // A later round appends a new check — earlier numbering never shifts.
    const rows2 = buildAcceptanceCheckUnion([
      { results: [], run: run('r1', 1, [planItem('a'), planItem('b')]) },
      { results: [], run: run('r2', 2, [planItem('a'), planItem('b'), planItem('c')]) },
    ]);
    expect(rows2.map((r) => `${r.id}:C${r.seq}`)).toEqual(['a:C1', 'b:C2', 'c:C3']);
  });

  it('records an item introduced by a later round', () => {
    const first = [planItem('a')];
    const second = [planItem('a'), planItem('empty-state')];
    const rows = buildAcceptanceCheckUnion([
      { results: [result('a', 'passed')], run: run('r1', 1, first) },
      {
        results: [result('a', 'passed'), result('empty-state', 'passed')],
        run: run('r2', 2, second),
      },
    ]);

    const introduced = rows.find((r) => r.id === 'empty-state')!;
    expect(introduced.introducedAtRound).toBe(2);
    expect(introduced.state).toBe('passed');
  });

  it('includes unplanned results and reads their snapshot title/required', () => {
    const rows = buildAcceptanceCheckUnion([
      {
        results: [
          result('surprise', 'failed', { checkItemTitle: 'Surprise finding', required: false }),
        ],
        run: run('r1', 1, []),
      },
    ]);

    expect(rows[0].title).toBe('Surprise finding');
    expect(rows[0].required).toBe(false);
    expect(rows[0].state).toBe('failed');
  });

  it('resolves the per-item surface from the plan verifierConfig, normalized', () => {
    const rows = buildAcceptanceCheckUnion([
      {
        results: [],
        run: run('r1', 1, [
          planItem('web-check', { verifierConfig: { surface: 'web' } }),
          planItem('desktop-check', { verifierConfig: { surface: 'electron' } }),
          planItem('bare-check'),
        ]),
      },
    ]);

    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('web-check')?.surface).toBe('web');
    expect(byId.get('desktop-check')?.surface).toBe('desktop');
    expect(byId.get('bare-check')?.surface).toBeNull();
  });

  it('prefers the latest plan snapshot for title/required', () => {
    const rows = buildAcceptanceCheckUnion([
      { results: [], run: run('r1', 1, [planItem('x', { title: 'old title' })]) },
      {
        results: [],
        run: run('r2', 2, [planItem('x', { required: false, title: 'new title' })]),
      },
    ]);

    expect(rows[0].title).toBe('new title');
    expect(rows[0].required).toBe(false);
  });

  it('builds the timeline with each round own wording', () => {
    const rows = buildAcceptanceCheckUnion([
      {
        results: [result('x', 'failed')],
        run: run('r1', 1, [planItem('x', { title: 'first wording' })]),
      },
      {
        results: [result('x', 'passed')],
        run: run('r2', 2, [planItem('x', { title: 'refined wording' })]),
      },
    ]);

    const row = rows[0];
    expect(row.revisions).toBe(2);
    expect(row.titleChanged).toBe(true);
    expect(row.timeline.map((entry) => `${entry.roundIndex}:${entry.title}`)).toEqual([
      '1:first wording',
      '2:refined wording',
    ]);
    // Re-runs with a stable wording are NOT an iteration.
    const stable = buildAcceptanceCheckUnion([
      { results: [result('y', 'passed')], run: run('r1', 1, [planItem('y')]) },
      { results: [result('y', 'passed')], run: run('r2', 2, [planItem('y')]) },
    ])[0];
    expect(stable.revisions).toBe(2);
    expect(stable.titleChanged).toBe(false);
  });

  it('folds superseded generations into the successor timeline', () => {
    const rows = buildAcceptanceCheckUnion([
      {
        results: [result('single-section', 'passed')],
        run: run('r1', 1, [planItem('single-section', { title: '仅未读时无分区标题' })]),
      },
      {
        results: [result('single-section-removed', 'passed')],
        run: run('r2', 2, [
          planItem('single-section-removed', {
            supersedes: ['single-section'],
            title: '单区标题规则已移除',
          }),
        ]),
      },
    ]);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe('single-section-removed');
    expect(row.supersededIds).toEqual(['single-section']);
    expect(row.introducedAtRound).toBe(1);
    expect(row.revisions).toBe(2);
    expect(row.titleChanged).toBe(true);
    expect(row.timeline.map((entry) => entry.title)).toEqual([
      '仅未读时无分区标题',
      '单区标题规则已移除',
    ]);
    expect(row.state).toBe('passed');
  });

  it('collapses a supersedes chain fully into the newest generation', () => {
    const rows = buildAcceptanceCheckUnion([
      { results: [result('a', 'failed')], run: run('r1', 1, [planItem('a')]) },
      {
        results: [result('b', 'failed')],
        run: run('r2', 2, [planItem('b', { supersedes: ['a'] })]),
      },
      {
        results: [result('c', 'passed')],
        run: run('r3', 3, [planItem('c', { supersedes: ['b'] })]),
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('c');
    expect(rows[0].supersededIds.sort()).toEqual(['a', 'b']);
    expect(rows[0].revisions).toBe(3);
    expect(rows[0].fixed).toBe(true);
  });

  it('reads the grouping category from the latest plan snapshot', () => {
    const rows = buildAcceptanceCheckUnion([
      { results: [], run: run('r1', 1, [planItem('x', { category: '未读区' })]) },
      { results: [], run: run('r2', 2, [planItem('x')]) },
    ]);

    expect(rows[0].category).toBe('未读区');
  });
});
