// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeProcessorContext } from '../../../../runtime/context';
import { defineUserMemoryActionHandler } from '../userMemory';

const memoryActionRunner = vi.fn();

const context = {
  now: () => 1,
  runtimeState: {
    getGuardState: vi.fn().mockResolvedValue({}),
    touchGuardState: vi.fn().mockResolvedValue({}),
  },
  scopeKey: 'topic:topic-1',
} as const satisfies RuntimeProcessorContext;

describe('defineUserMemoryActionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the memory action through the injected memory agent runner', async () => {
    memoryActionRunner.mockResolvedValue({
      status: 'applied',
    });

    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_memory_agent',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 100 },
          evidence: [{ cue: 'going forward', excerpt: 'Keep code review comments concise.' }],
          feedbackHint: 'not_satisfied',
          idempotencyKey: 'source_1:memory:msg_1',
          message: 'Going forward, keep code review comments concise and file-specific.',
          reason: 'durable future preference for code review',
          serializedContext: '{"surface":"chat"}',
          sourceHints: { intents: ['memory'] },
          topicId: 'topic_1',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.memory',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(memoryActionRunner).toHaveBeenCalledWith({
      agentId: 'agent_1',
      conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 100 },
      evidence: [{ cue: 'going forward', excerpt: 'Keep code review comments concise.' }],
      feedbackHint: 'not_satisfied',
      message: 'Going forward, keep code review comments concise and file-specific.',
      reason: 'durable future preference for code review',
      serializedContext: '{"surface":"chat"}',
      sourceHints: { intents: ['memory'] },
      topicId: 'topic_1',
    });
    expect(result?.status).toBe('applied');
    expect(context.runtimeState.touchGuardState).toHaveBeenCalledTimes(1);
  });

  it('skips memory actions when the feedback message is missing', async () => {
    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_missing_message',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          idempotencyKey: 'source_1:memory:msg_missing',
          message: '   ',
        },
        signal: {
          signalId: 'sig_missing',
          signalType: 'signal.feedback.domain.memory',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(memoryActionRunner).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      detail: 'Missing memory action message.',
      status: 'skipped',
    });
  });

  it('skips repeated actions after the same idempotency key was already applied', async () => {
    memoryActionRunner.mockResolvedValue({
      status: 'applied',
    });

    const getGuardState = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ lastEventAt: 1 });
    const touchGuardState = vi.fn().mockResolvedValue({});
    const idempotentContext = {
      ...context,
      runtimeState: { getGuardState, touchGuardState },
    } as const satisfies RuntimeProcessorContext;
    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const action = {
      actionId: 'act_idempotent',
      actionType: 'action.user-memory.handle',
      chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
      payload: {
        agentId: 'agent_1',
        idempotencyKey: 'source_1:memory:msg_repeat',
        message: 'Remember that I prefer conclusion-first answers.',
      },
      signal: {
        signalId: 'sig_repeat',
        signalType: 'signal.feedback.domain.memory',
      },
      source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
      timestamp: 1,
    } as const;

    const first = await handler.handle(action, idempotentContext);
    const second = await handler.handle(action, idempotentContext);

    expect(first?.status).toBe('applied');
    expect(second).toMatchObject({
      detail: 'Action idempotency key already applied.',
      status: 'skipped',
    });
    expect(memoryActionRunner).toHaveBeenCalledTimes(1);
  });

  it('surfaces memory agent failures without marking idempotency', async () => {
    memoryActionRunner.mockResolvedValue({
      detail: 'Memory action agent finished with an error.',
      status: 'failed',
    });

    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_failed',
        actionType: 'action.user-memory.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:memory:msg_failed',
          message: 'Remember the style I liked yesterday.',
        },
        signal: {
          signalId: 'sig_failed',
          signalType: 'signal.feedback.domain.memory',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(result).toMatchObject({
      detail: 'Memory action agent finished with an error.',
      status: 'failed',
    });
    expect(context.runtimeState.touchGuardState).not.toHaveBeenCalled();
  });

  it('does not poison the idempotency lane when the first agent attempt fails', async () => {
    memoryActionRunner
      .mockResolvedValueOnce({
        detail: 'Memory action agent finished with an error.',
        status: 'failed',
      })
      .mockResolvedValueOnce({
        status: 'applied',
      });

    const getGuardState = vi.fn().mockResolvedValue({});
    const touchGuardState = vi.fn().mockResolvedValue({});
    const retryableContext = {
      ...context,
      runtimeState: { getGuardState, touchGuardState },
    } as const satisfies RuntimeProcessorContext;
    const handler = defineUserMemoryActionHandler({
      db: {} as never,
      memoryActionRunner,
      userId: 'user_1',
    });

    const action = {
      actionId: 'act_retryable',
      actionType: 'action.user-memory.handle',
      chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
      payload: {
        agentId: 'agent_1',
        idempotencyKey: 'source_1:memory:msg_retry',
        message: 'Going forward, remember that I want concise answers.',
      },
      signal: {
        signalId: 'sig_retry',
        signalType: 'signal.feedback.domain.memory',
      },
      source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
      timestamp: 1,
    } as const;

    const first = await handler.handle(action, retryableContext);
    const second = await handler.handle(action, retryableContext);

    expect(first?.status).toBe('failed');
    expect(second?.status).toBe('applied');
    expect(touchGuardState).toHaveBeenCalledTimes(1);
    expect(memoryActionRunner).toHaveBeenCalledTimes(2);
  });
});
