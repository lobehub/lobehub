// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { LinearSyncJobRow } from '@/database/models/linear';

import {
  LINEAR_SYNC_MAX_ROUNDS,
  LINEAR_SYNC_STALE_MS,
  LINEAR_SYNC_UNCLAIMED_MS,
  mergeLinearSyncResults,
  nextLinearSyncRound,
  toLinearSyncJobView,
  withinRoundCap,
} from '../syncJob';

const now = Date.UTC(2026, 9, 27, 12);

const row = (overrides: Partial<LinearSyncJobRow>): LinearSyncJobRow =>
  ({
    createdAt: new Date(now - 1000),
    error: null,
    id: 'job-1',
    metadata: { connectionId: 'c', issueIds: ['a', 'b'], kind: 'issues', projectId: 'p' },
    status: 'processing',
    updatedAt: new Date(now - 1000),
    ...overrides,
  }) as LinearSyncJobRow;

describe('toLinearSyncJobView', () => {
  it('keeps a recently active job running', () => {
    expect(toLinearSyncJobView(row({}), now)).toMatchObject({
      error: null,
      issueCount: 2,
      status: 'processing',
    });
  });

  it('shows a job that stopped moving as timed out, so it can be started again', () => {
    const stale = row({ updatedAt: new Date(now - LINEAR_SYNC_STALE_MS - 1) });
    expect(toLinearSyncJobView(stale, now)).toMatchObject({ error: 'timeout', status: 'error' });
  });

  it('gives up on a job the async router never picked up after a short wait', () => {
    const waiting = row({ status: 'pending', updatedAt: new Date(now - 30_000) });
    expect(toLinearSyncJobView(waiting, now)).toMatchObject({ status: 'pending' });
    const lost = row({
      status: 'pending',
      updatedAt: new Date(now - LINEAR_SYNC_UNCLAIMED_MS - 1),
    });
    expect(toLinearSyncJobView(lost, now)).toMatchObject({ error: 'timeout', status: 'error' });
  });

  it('passes through a recorded failure, defaulting to a generic one', () => {
    expect(
      toLinearSyncJobView(row({ error: { code: 'reconnect' }, status: 'error' }), now),
    ).toMatchObject({ error: 'reconnect', status: 'error' });
    expect(toLinearSyncJobView(row({ status: 'error' }), now)).toMatchObject({ error: 'failed' });
  });
});

const result = (overrides: Record<string, unknown> = {}) => ({
  closed: 0,
  created: 0,
  keptLocalEdits: 0,
  skipped: [],
  skippedCount: 0,
  truncated: false,
  unchanged: 0,
  updated: 0,
  ...overrides,
});

describe('nextLinearSyncRound', () => {
  it('reads on from the cursor while rounds stop at the cap', () => {
    expect(
      nextLinearSyncRound(undefined, result({ created: 100, resumeAfter: 'a', truncated: true })),
    ).toEqual({ cursor: 'a' });
    // Nothing created, but the cursor moved past issues it could not import.
    expect(nextLinearSyncRound('a', result({ resumeAfter: 'b', truncated: true }))).toEqual({
      cursor: 'b',
    });
  });

  it('stops a round that would only repeat itself', () => {
    expect(nextLinearSyncRound('a', result({ resumeAfter: 'a', truncated: true }))).toBeUndefined();
    expect(nextLinearSyncRound(undefined, result({ truncated: true }))).toBeUndefined();
  });

  it('ends a resumed run with one pass from the start, and stops after it', () => {
    expect(nextLinearSyncRound('a', result({ created: 5 }))).toEqual({ sweep: true });
    expect(nextLinearSyncRound(undefined, result({ created: 5 }))).toBeUndefined();
  });
});

describe('mergeLinearSyncResults', () => {
  const skipped = (identifier: string) => ({ identifier, reason: 'closed' as const });

  it('adds up what a resumed round saw, since it covered new issues only', () => {
    const merged = mergeLinearSyncResults(
      result({ created: 100, skipped: [skipped('A')], skippedCount: 1, unchanged: 3 }),
      result({ created: 50, skipped: [skipped('B')], skippedCount: 2, unchanged: 4 }),
      { resumed: true },
    );
    expect(merged).toMatchObject({ created: 150, skippedCount: 3, unchanged: 7 });
    expect(merged.skipped).toEqual([skipped('A'), skipped('B')]);
  });

  it('takes what a pass from the start saw from it alone', () => {
    expect(
      mergeLinearSyncResults(
        result({ closed: 1, created: 100, skippedCount: 1, unchanged: 3 }),
        result({ closed: 2, created: 0, skippedCount: 1, unchanged: 100 }),
        { resumed: false },
      ),
    ).toMatchObject({ closed: 3, created: 100, skippedCount: 1, unchanged: 100 });
  });
});

describe('withinRoundCap', () => {
  const cap = LINEAR_SYNC_MAX_ROUNDS;

  it('lets rounds on below the cap', () => {
    expect(withinRoundCap({ cursor: 'a' }, cap - 1, true)).toEqual({ cursor: 'a' });
  });

  it('turns a capped resumed run into the closing pass', () => {
    expect(withinRoundCap({ cursor: 'a' }, cap, true)).toEqual({ sweep: true });
    expect(withinRoundCap({ sweep: true }, cap, true)).toEqual({ sweep: true });
  });

  it('ends a capped run whose last round already read from the start', () => {
    expect(withinRoundCap({ cursor: 'a' }, cap + 1, false)).toBeUndefined();
    expect(withinRoundCap(undefined, cap, true)).toBeUndefined();
  });
});
