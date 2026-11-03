// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { LinearSyncJobRow } from '@/database/models/linear';

import { LINEAR_SYNC_STALE_MS, LINEAR_SYNC_UNCLAIMED_MS, toLinearSyncJobView } from '../syncJob';

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
