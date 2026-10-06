import type { GoalItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  countChargedTaskAttempts,
  countConsecutiveDeviceOfflineRuns,
  DEFAULT_MANAGER_MAX_TURNS,
  managerTurnsSpent,
  MIN_OPERATION_LEASE_TIMEOUT_MS,
  nextDeviceOfflineRetryAt,
  resolveFailedRunStatus,
  resolveOperationLeaseTimeout,
} from './recoveryPolicy';

describe('resolveOperationLeaseTimeout', () => {
  it('does not allow a lease shorter than two durable heartbeat intervals', () => {
    const goal = {
      config: { recovery: { operationLeaseTimeoutMs: 10_000 } },
    } as GoalItem;

    expect(resolveOperationLeaseTimeout(goal)).toBe(MIN_OPERATION_LEASE_TIMEOUT_MS);
  });
});

describe('managerTurnsSpent', () => {
  const config = (turns: number, maxTurns?: number) =>
    ({
      manager: maxTurns === undefined ? {} : { maxTurns },
      managerState: { turns },
    }) as GoalItem['config'];

  it('gives a main Agent without its own cap 50 turns', () => {
    expect(DEFAULT_MANAGER_MAX_TURNS).toBe(50);
    expect(managerTurnsSpent(config(49))).toBe(false);
    expect(managerTurnsSpent(config(50))).toBe(true);
  });

  it('keeps a per-goal cap', () => {
    expect(managerTurnsSpent(config(12, 12))).toBe(true);
    expect(managerTurnsSpent(config(12, 20))).toBe(false);
  });
});

describe('nextDeviceOfflineRetryAt', () => {
  const MINUTE = 60 * 1000;
  const lastFailureAt = new Date('2026-01-01T00:00:00.000Z');
  const delayAfter = (failures: number) => {
    const at = nextDeviceOfflineRetryAt(failures, lastFailureAt);
    return at && (at.getTime() - lastFailureAt.getTime()) / MINUTE;
  };

  it('doubles from 30 minutes and caps each interval at 8 hours', () => {
    expect([1, 2, 3, 4, 5, 6].map(delayAfter)).toEqual([30, 60, 120, 240, 480, 480]);
  });

  it('stops scheduling once six offline retries have been spent', () => {
    expect(nextDeviceOfflineRetryAt(7, lastFailureAt)).toBeUndefined();
  });
});

describe('offline run accounting', () => {
  it('counts only the offline streak since the last run that reached its device', () => {
    const runs = [
      { status: 'device_offline' },
      { status: 'device_offline' },
      { status: 'completed' },
      { status: 'device_offline' },
    ];
    expect(countConsecutiveDeviceOfflineRuns(runs)).toBe(2);
  });

  it('does not charge offline runs to the attempt budget', () => {
    expect(countChargedTaskAttempts({ totalTopics: 4 }, 3)).toBe(1);
  });

  it('marks a failed run offline only for device-unavailable errors', () => {
    expect(resolveFailedRunStatus('DEVICE_OFFLINE (HTTP 503)')).toBe('device_offline');
    expect(resolveFailedRunStatus('Delivery did not pass verification.')).toBe('failed');
  });
});
