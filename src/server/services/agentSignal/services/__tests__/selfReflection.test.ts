import { describe, expect, it, vi } from 'vitest';

import type { AgentSignalSourceEventInput } from '@/server/services/agentSignal/emitter';

import { createSelfReflectionService } from '../selfReflection';

describe('selfReflection', () => {
  /**
   * @example
   * Threshold decision emits a stable self-reflection source event.
   */
  it('emits self-reflection source events from threshold decisions', async () => {
    const enqueueSource = vi
      .fn<
        (input: AgentSignalSourceEventInput<'agent.self_reflection.requested'>) => Promise<unknown>
      >()
      .mockResolvedValue({ enqueued: true });
    const service = createSelfReflectionService({
      enqueueSource,
    });

    await service.requestSelfReflection({
      agentId: 'agent-1',
      reason: 'failed_tool_count',
      scopeId: 'task-1',
      scopeType: 'task',
      taskId: 'task-1',
      userId: 'user-1',
      windowEnd: '2026-05-04T14:30:00.000Z',
      windowStart: '2026-05-04T14:00:00.000Z',
    });

    expect(enqueueSource).toHaveBeenCalledWith({
      payload: {
        agentId: 'agent-1',
        reason: 'failed_tool_count',
        scopeId: 'task-1',
        scopeType: 'task',
        taskId: 'task-1',
        userId: 'user-1',
        windowEnd: '2026-05-04T14:30:00.000Z',
        windowStart: '2026-05-04T14:00:00.000Z',
      },
      sourceId:
        'self-reflection:user-1:agent-1:task:task-1:failed_tool_count:2026-05-04T14:00:00.000Z:2026-05-04T14:30:00.000Z',
      sourceType: 'agent.self_reflection.requested',
    });
  });

  /**
   * @example
   * Disabled request gates skip enqueueing before source payload creation crosses side-effect
   * boundaries.
   */
  it('skips enqueueing when request gate rejects the reflection', async () => {
    const enqueueSource = vi
      .fn<
        (input: AgentSignalSourceEventInput<'agent.self_reflection.requested'>) => Promise<unknown>
      >()
      .mockResolvedValue({ enqueued: true });
    const canRequestSelfReflection = vi.fn().mockResolvedValue(false);
    const service = createSelfReflectionService({
      canRequestSelfReflection,
      enqueueSource,
    });

    const result = await service.requestSelfReflection({
      agentId: 'agent-1',
      reason: 'failed_tool_count',
      scopeId: 'task-1',
      scopeType: 'task',
      taskId: 'task-1',
      userId: 'user-1',
      windowEnd: '2026-05-04T14:30:00.000Z',
      windowStart: '2026-05-04T14:00:00.000Z',
    });

    expect(result).toEqual({ enqueued: false, reason: 'request_gate_rejected' });
    expect(enqueueSource).not.toHaveBeenCalled();
  });

  /**
   * @example
   * Disabled enqueue gates skip the queue call after the stable source event is known.
   */
  it('skips enqueueing when enqueue gate rejects the source event', async () => {
    const enqueueSource = vi
      .fn<
        (input: AgentSignalSourceEventInput<'agent.self_reflection.requested'>) => Promise<unknown>
      >()
      .mockResolvedValue({ enqueued: true });
    const canEnqueue = vi.fn().mockResolvedValue(false);
    const service = createSelfReflectionService({
      canEnqueue,
      enqueueSource,
    });

    const result = await service.requestSelfReflection({
      agentId: 'agent-1',
      reason: 'failed_tool_count',
      scopeId: 'task-1',
      scopeType: 'task',
      taskId: 'task-1',
      userId: 'user-1',
      windowEnd: '2026-05-04T14:30:00.000Z',
      windowStart: '2026-05-04T14:00:00.000Z',
    });

    expect(canEnqueue).toHaveBeenCalledWith({
      payload: {
        agentId: 'agent-1',
        reason: 'failed_tool_count',
        scopeId: 'task-1',
        scopeType: 'task',
        taskId: 'task-1',
        userId: 'user-1',
        windowEnd: '2026-05-04T14:30:00.000Z',
        windowStart: '2026-05-04T14:00:00.000Z',
      },
      sourceId:
        'self-reflection:user-1:agent-1:task:task-1:failed_tool_count:2026-05-04T14:00:00.000Z:2026-05-04T14:30:00.000Z',
      sourceType: 'agent.self_reflection.requested',
    });
    expect(result).toEqual({
      enqueued: false,
      reason: 'enqueue_gate_rejected',
      sourceId:
        'self-reflection:user-1:agent-1:task:task-1:failed_tool_count:2026-05-04T14:00:00.000Z:2026-05-04T14:30:00.000Z',
    });
    expect(enqueueSource).not.toHaveBeenCalled();
  });
});
