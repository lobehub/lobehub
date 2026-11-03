import type { LinearSyncResult } from '@lobechat/types';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { formatLinearSyncResult, isActiveLinearSyncJob, linearSyncJobErrorMessage } from './utils';

const t = ((key: string, options?: { count?: number }) =>
  options?.count === undefined
    ? key
    : `${key}:${options.count}`) as unknown as TFunction<'integration'>;

const result = (overrides: Partial<LinearSyncResult>): LinearSyncResult => ({
  closed: 0,
  created: 0,
  keptLocalEdits: 0,
  skipped: [],
  truncated: false,
  unchanged: 0,
  updated: 0,
  ...overrides,
});

describe('formatLinearSyncResult', () => {
  it('lists only what changed, and says when more remain', () => {
    expect(
      formatLinearSyncResult(
        result({
          closed: 1,
          created: 2,
          skipped: [{ identifier: 'ENG-1', reason: 'running' }],
          truncated: true,
        }),
        t,
      ),
    ).toBe(
      'linear.sync.result.created:2 · linear.sync.result.closed:1 · linear.sync.result.skipped:1 · linear.sync.result.truncated',
    );
  });

  it('counts skipped issues past the stored list', () => {
    expect(
      formatLinearSyncResult(
        result({ skipped: [{ identifier: 'ENG-1', reason: 'failed' }], skippedCount: 150 }),
        t,
      ),
    ).toBe('linear.sync.result.skipped:150');
  });

  it('says up to date when nothing changed', () => {
    expect(formatLinearSyncResult(result({ unchanged: 3 }), t)).toBe('linear.sync.result.upToDate');
  });
});

describe('background sync jobs', () => {
  it('treats queued and running jobs as active', () => {
    expect(isActiveLinearSyncJob({ status: 'pending' })).toBe(true);
    expect(isActiveLinearSyncJob({ status: 'processing' })).toBe(true);
    expect(isActiveLinearSyncJob({ status: 'success' })).toBe(false);
    expect(isActiveLinearSyncJob({ status: 'error' })).toBe(false);
  });

  it('explains each way a job can fail', () => {
    expect(linearSyncJobErrorMessage('reconnect', t)).toBe('linear.sync.error.reconnect');
    expect(linearSyncJobErrorMessage('unavailable', t)).toBe('linear.sync.job.error.unavailable');
    expect(linearSyncJobErrorMessage('timeout', t)).toBe('linear.sync.job.error.timeout');
    expect(linearSyncJobErrorMessage('failed', t)).toBe('linear.sync.error.generic');
    expect(linearSyncJobErrorMessage(null, t)).toBe('linear.sync.error.generic');
  });
});
