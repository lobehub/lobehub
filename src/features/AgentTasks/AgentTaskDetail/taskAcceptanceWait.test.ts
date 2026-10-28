import type { TaskDetailActivity } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveRunAcceptanceWait, resolveTaskAcceptanceWait } from './taskAcceptanceWait';

type Topic = Pick<TaskDetailActivity, 'id' | 'runningOperation' | 'verify'>;

const verify = (status: string | null, passed = 0, total = 0) => ({
  acceptanceId: 'acc-1',
  passed,
  roundIndex: 9,
  runId: 'run-1',
  status,
  total,
});

const liveOperation = { operationId: 'op-live' } as NonNullable<Topic['runningOperation']>;

describe('resolveTaskAcceptanceWait', () => {
  it('reports the repairing round of a running task whose agent has stopped', () => {
    const topics: Topic[] = [
      { id: 'tpc-1', runningOperation: null, verify: null },
      { id: 'tpc-4', runningOperation: null, verify: verify('repairing', 2, 4) },
    ];

    expect(resolveTaskAcceptanceWait('running', topics)).toEqual({
      acceptanceId: 'acc-1',
      passed: 2,
      phase: 'repairing',
      roundIndex: 9,
      topicId: 'tpc-4',
      total: 4,
    });
  });

  it('keeps an executing task as executing while any run holds a live operation', () => {
    const topics: Topic[] = [
      { id: 'tpc-4', runningOperation: null, verify: verify('repairing', 2, 4) },
      { id: 'tpc-5', runningOperation: liveOperation, verify: null },
    ];

    expect(resolveTaskAcceptanceWait('running', topics)).toBeUndefined();
  });

  it('claims nothing for a task that is not running', () => {
    const topics: Topic[] = [{ id: 'tpc-4', runningOperation: null, verify: verify('repairing') }];

    expect(resolveTaskAcceptanceWait('paused', topics)).toBeUndefined();
    expect(resolveTaskAcceptanceWait('completed', topics)).toBeUndefined();
  });

  it('claims nothing when no run is verify-bound', () => {
    expect(
      resolveTaskAcceptanceWait('running', [{ id: 'tpc-1', runningOperation: null, verify: null }]),
    ).toBeUndefined();
  });

  it('follows the newest verify-bound run', () => {
    const topics: Topic[] = [
      { id: 'tpc-1', runningOperation: null, verify: verify('repairing', 1, 4) },
      { id: 'tpc-2', runningOperation: null, verify: verify('delivered', 4, 4) },
    ];

    expect(resolveTaskAcceptanceWait('running', topics)).toMatchObject({
      phase: 'awaitingReview',
      topicId: 'tpc-2',
    });
  });
});

describe('resolveRunAcceptanceWait', () => {
  it.each([
    ['planned', 'awaitingEvidence'],
    ['collecting_evidence', 'awaitingEvidence'],
    [null, 'awaitingEvidence'],
    ['verifying', 'verifying'],
    ['repairing', 'repairing'],
    ['delivered', 'awaitingReview'],
    ['failed', 'awaitingDecision'],
    ['errored', 'awaitingDecision'],
  ] as const)('maps a %s round to %s', (status, phase) => {
    expect(
      resolveRunAcceptanceWait({ id: 'tpc', runningOperation: null, verify: verify(status) })
        ?.phase,
    ).toBe(phase);
  });

  it('does not report a passed round as waiting', () => {
    expect(
      resolveRunAcceptanceWait({ id: 'tpc', runningOperation: null, verify: verify('passed') }),
    ).toBeUndefined();
  });
});
