import type { GoalItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { MIN_OPERATION_LEASE_TIMEOUT_MS, resolveOperationLeaseTimeout } from './recoveryPolicy';

describe('resolveOperationLeaseTimeout', () => {
  it('does not allow a lease shorter than two durable heartbeat intervals', () => {
    const goal = {
      config: { recovery: { operationLeaseTimeoutMs: 10_000 } },
    } as GoalItem;

    expect(resolveOperationLeaseTimeout(goal)).toBe(MIN_OPERATION_LEASE_TIMEOUT_MS);
  });
});
