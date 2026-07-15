// @vitest-environment node
import type { VerifyCheckItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { VerifyCheckResultItem, VerifyRunItem } from '@/database/schemas/verify';

import { buildAcceptanceCheckUnion } from '../acceptanceService';

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
