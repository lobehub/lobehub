import { describe, expect, it } from 'vitest';

import {
  AGENT_SIGNAL_SOURCE_TYPES,
  createSourceEvent,
  getSourceEventScopeKey,
  isAgentUserMessageSource,
  isClientRuntimeStartSource,
  isNightlyReviewSource,
  isSelfIterationIntentSource,
  isSelfReflectionSource,
  isToolOutcomeSource,
} from './index';

describe('AgentSignal source events', () => {
  /**
   * @example
   * createSourceEvent({ sourceType: 'bot.message.merged', sourceId: 'src-1', payload })
   * returns a normalized source event with a bot thread scope key.
   */
  it('creates a normalized source event with a derived bot thread scope key', () => {
    const event = createSourceEvent({
      payload: {
        applicationId: 'discord-app',
        message: 'hello',
        platform: 'discord',
        platformThreadId: 'thread-1',
      },
      sourceId: 'src-1',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged,
      timestamp: 123,
    });

    expect(event).toEqual({
      payload: {
        applicationId: 'discord-app',
        message: 'hello',
        platform: 'discord',
        platformThreadId: 'thread-1',
      },
      scopeKey: 'bot:discord:discord-app:thread-1',
      sourceId: 'src-1',
      sourceType: 'bot.message.merged',
      timestamp: 123,
    });
  });

  /**
   * @example
   * getSourceEventScopeKey({ topicId: 'topic-1' }) returns 'topic:topic-1'.
   */
  it('prefers topic scope over bot thread scope', () => {
    expect(
      getSourceEventScopeKey({
        applicationId: 'discord-app',
        platform: 'discord',
        platformThreadId: 'thread-1',
        topicId: 'topic-1',
      }),
    ).toBe('topic:topic-1');
  });

  /**
   * @example
   * createSourceEvent({ sourceType: 'agent.nightly_review.requested', sourceId, payload })
   * returns an agent-user scoped nightly review event.
   */
  it('creates a nightly review event with explicit agent-user scope', () => {
    const event = createSourceEvent({
      payload: {
        agentId: 'agent-1',
        localDate: '2026-05-04',
        requestedAt: '2026-05-04T14:30:00.000Z',
        reviewWindowEnd: '2026-05-04T14:30:00.000Z',
        reviewWindowStart: '2026-05-03T16:00:00.000Z',
        timezone: 'Asia/Shanghai',
        userId: 'user-1',
      },
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
      timestamp: 123,
    });

    expect(event).toEqual({
      payload: {
        agentId: 'agent-1',
        localDate: '2026-05-04',
        requestedAt: '2026-05-04T14:30:00.000Z',
        reviewWindowEnd: '2026-05-04T14:30:00.000Z',
        reviewWindowStart: '2026-05-03T16:00:00.000Z',
        timezone: 'Asia/Shanghai',
        userId: 'user-1',
      },
      scopeKey: 'agent:agent-1:user:user-1',
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      sourceType: 'agent.nightly_review.requested',
      timestamp: 123,
    });
  });

  /**
   * @example
   * getSourceEventScopeKey({ taskId: 'task-1' }) returns 'task:task-1'.
   */
  it('derives task scope for self-reflection payloads before agent-user fallback', () => {
    const event = createSourceEvent({
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
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
      timestamp: 456,
    });

    expect(event.scopeKey).toBe('task:task-1');
    expect(event.sourceType).toBe('agent.self_reflection.requested');
  });

  /**
   * @example
   * createSourceEvent({ sourceType: 'agent.self_iteration_intent.declared', sourceId, payload })
   * returns a topic scoped tool-declared source event.
   */
  it('creates a self-iteration intent event in the current topic scope', () => {
    const event = createSourceEvent({
      payload: {
        action: 'refine',
        agentId: 'agent-1',
        confidence: 0.92,
        kind: 'skill',
        reason: 'The running agent noticed a reusable workflow correction.',
        summary: 'Refine the release note skill with the corrected checklist.',
        toolCallId: 'tool-call-1',
        topicId: 'topic-1',
        userId: 'user-1',
      },
      sourceId: 'self-iteration-intent:user-1:agent-1:topic:topic-1:tool-call-1',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfIterationIntentDeclared,
      timestamp: 789,
    });

    expect(event.scopeKey).toBe('topic:topic-1');
    expect(event.sourceType).toBe('agent.self_iteration_intent.declared');
  });

  /**
   * @example
   * isToolOutcomeSource(createSourceEvent({ sourceType: 'tool.outcome.failed', ... })) returns true.
   */
  it('narrows source events with source package guards', () => {
    const clientRuntimeStart = createSourceEvent({
      payload: {
        operationId: 'operation-1',
        parentMessageId: 'message-1',
        parentMessageType: 'user',
      },
      sourceId: 'source-client-runtime-start',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.clientRuntimeStart,
      timestamp: 123,
    });
    const agentUserMessage = createSourceEvent({
      payload: {
        message: 'hello',
        messageId: 'message-1',
      },
      sourceId: 'source-agent-user-message',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
      timestamp: 123,
    });
    const nightlyReview = createSourceEvent({
      payload: {
        agentId: 'agent-1',
        localDate: '2026-05-04',
        requestedAt: '2026-05-04T14:30:00.000Z',
        reviewWindowEnd: '2026-05-04T14:30:00.000Z',
        reviewWindowStart: '2026-05-03T16:00:00.000Z',
        timezone: 'Asia/Shanghai',
        userId: 'user-1',
      },
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
      timestamp: 123,
    });
    const selfReflection = createSourceEvent({
      payload: {
        agentId: 'agent-1',
        reason: 'failed_tool_count',
        scopeId: 'task-1',
        scopeType: 'task',
        userId: 'user-1',
        windowEnd: '2026-05-04T14:30:00.000Z',
        windowStart: '2026-05-04T14:00:00.000Z',
      },
      sourceId: 'self-reflection:user-1:agent-1:task:task-1:failed_tool_count:start:end',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
      timestamp: 123,
    });
    const selfIterationIntent = createSourceEvent({
      payload: {
        action: 'refine',
        agentId: 'agent-1',
        confidence: 0.92,
        kind: 'skill',
        reason: 'Reusable correction.',
        summary: 'Refine skill.',
        userId: 'user-1',
      },
      sourceId: 'self-iteration-intent:user-1:agent-1:topic:topic-1:tool-call-1',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfIterationIntentDeclared,
      timestamp: 123,
    });
    const failedToolOutcome = createSourceEvent({
      payload: {
        outcome: { status: 'failed' },
        tool: { identifier: 'tool-1' },
      },
      sourceId: 'source-tool-outcome-failed',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed,
      timestamp: 123,
    });

    expect(isClientRuntimeStartSource(clientRuntimeStart)).toBe(true);
    expect(isAgentUserMessageSource(agentUserMessage)).toBe(true);
    expect(isNightlyReviewSource(nightlyReview)).toBe(true);
    expect(isSelfReflectionSource(selfReflection)).toBe(true);
    expect(isSelfIterationIntentSource(selfIterationIntent)).toBe(true);
    expect(isToolOutcomeSource(failedToolOutcome)).toBe(true);
    expect(isToolOutcomeSource(agentUserMessage)).toBe(false);
  });
});
