import type { DeviceCliBatchEntry, DeviceCliUpdateStateResult } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { deriveBatchRowView, summarizeBatch } from './deriveBatchRowView';

const operation = {
  fromInstanceId: 'old',
  id: '89d177cf-52e5-4d55-b71c-13deef4ea366',
  kind: 'update' as const,
  stage: 'updating' as const,
  targetVersion: '0.0.75',
};

const requested: DeviceCliBatchEntry = { deviceId: 'd', operation, outcome: 'requested' };

const reported = (
  instanceId: string,
  currentVersion: string,
  patch: object = {},
): DeviceCliUpdateStateResult => ({
  state: { activeTasks: 0, currentVersion, instanceId, supported: true, ...patch },
  status: 'ok',
});

describe('deriveBatchRowView', () => {
  it.each(['ready', 'upToDate', 'busy', 'inProgress', 'unsupported', 'offline', 'failed'] as const)(
    'shows the %s plan outcome as is',
    (outcome) => {
      expect(deriveBatchRowView({ deviceId: 'd', outcome })).toBe(outcome);
    },
  );

  it('waits while the device is away or still on the old process', () => {
    expect(deriveBatchRowView(requested)).toBe('pending');
    expect(deriveBatchRowView(requested, { message: 'offline', status: 'unavailable' })).toBe(
      'pending',
    );
    expect(deriveBatchRowView(requested, reported('old', '0.0.70', { operation }))).toBe('pending');
  });

  it('succeeds once a new process reports the target version', () => {
    expect(deriveBatchRowView(requested, reported('new', '0.0.75'))).toBe('success');
  });

  it('does not count a reconnect on the old version as success', () => {
    expect(deriveBatchRowView(requested, reported('new', '0.0.70'))).toBe('pending');
  });

  it('fails when the device reports the operation failed', () => {
    expect(
      deriveBatchRowView(
        requested,
        reported('old', '0.0.70', { operation: { ...operation, error: 'npm', stage: 'failed' } }),
      ),
    ).toBe('failed');
  });

  it('times out a request that never settled', () => {
    expect(deriveBatchRowView(requested, undefined, true)).toBe('timedOut');
  });
});

describe('summarizeBatch', () => {
  it('counts each row once', () => {
    expect(
      summarizeBatch([
        'ready',
        'ready',
        'pending',
        'success',
        'failed',
        'timedOut',
        'busy',
        'offline',
        'upToDate',
      ]),
    ).toEqual({ failed: 2, pending: 1, ready: 2, skipped: 3, updated: 1 });
  });
});
