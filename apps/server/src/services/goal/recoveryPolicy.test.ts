import type { GoalItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MANAGER_MAX_TURNS,
  managerTurnsSpent,
  MIN_OPERATION_LEASE_TIMEOUT_MS,
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
