import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOperationHeartbeat } from './OperationHeartbeat';

afterEach(() => {
  vi.useRealTimers();
});

describe('createOperationHeartbeat', () => {
  it('renews a silent operation using the latest observed step', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T08:00:00.000Z'));
    const events: AgentStreamEvent[] = [];
    const heartbeat = createOperationHeartbeat({
      intervalMs: 1000,
      operationId: 'op-test',
      push: (event) => events.push(event),
    });

    heartbeat.observe({
      data: {},
      operationId: 'op-test',
      stepIndex: 4,
      timestamp: Date.now(),
      type: 'stream_chunk',
    });
    vi.advanceTimersByTime(1000);

    expect(events).toEqual([
      {
        data: { phase: 'operation_heartbeat' },
        operationId: 'op-test',
        stepIndex: 4,
        timestamp: Date.now(),
        type: 'step_complete',
      },
    ]);

    heartbeat.stop();
    vi.advanceTimersByTime(1000);
    expect(events).toHaveLength(1);
  });
});
