import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { describe, expect, it } from 'vitest';

import {
  AGENT_SIGNAL_TRIGGER_SOURCE_TYPES,
  buildTriggerSourceEvent,
  isAgentSignalTriggerSourceType,
} from '../triggerSourceEvent';

// Fixed clock so derived ids / windows are deterministic.
const NOW = Date.parse('2026-05-31T12:00:00.000Z');
const userId = 'user_1';
const agentId = 'agent_1';

describe('isAgentSignalTriggerSourceType', () => {
  it('accepts every advertised trigger source type', () => {
    for (const type of AGENT_SIGNAL_TRIGGER_SOURCE_TYPES) {
      expect(isAgentSignalTriggerSourceType(type)).toBe(true);
    }
  });

  it('rejects client-only / unknown source types', () => {
    expect(isAgentSignalTriggerSourceType('client.runtime.start')).toBe(false);
    expect(isAgentSignalTriggerSourceType('not.a.real.type')).toBe(false);
  });
});

describe('buildTriggerSourceEvent', () => {
  it('builds a nightly review event with a stable source id and derived window', () => {
    const event = buildTriggerSourceEvent({
      agentId,
      now: NOW,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
      userId,
    });

    expect(event.sourceType).toBe(AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested);
    expect(event.sourceId).toBe('nightly-review:user_1:agent_1:2026-05-31');
    const payload = event.payload as Record<string, unknown>;
    expect(payload.userId).toBe(userId);
    expect(payload.localDate).toBe('2026-05-31');
    expect(payload.reviewWindowEnd).toBe('2026-05-31T12:00:00.000Z');
    expect(payload.reviewWindowStart).toBe('2026-05-30T12:00:00.000Z');
  });

  it('builds a self-reflection event scoped to the topic when provided', () => {
    const event = buildTriggerSourceEvent({
      agentId,
      now: NOW,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfReflectionRequested,
      topicId: 'tpc_1',
      userId,
    });

    const payload = event.payload as Record<string, unknown>;
    expect(payload.scopeType).toBe('topic');
    expect(payload.scopeId).toBe('tpc_1');
    expect(payload.topicId).toBe('tpc_1');
    expect(event.sourceId).toContain('self-reflection:user_1:agent_1:topic:tpc_1');
  });

  it('builds a self-feedback-intent event with default memory action', () => {
    const event = buildTriggerSourceEvent({
      agentId,
      now: NOW,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentSelfFeedbackIntentDeclared,
      userId,
    });

    const payload = event.payload as Record<string, unknown>;
    expect(payload.action).toBe('write');
    expect(payload.kind).toBe('memory');
    expect(payload.confidence).toBe(0.9);
    expect(event.sourceId).toBe(
      'self-feedback-intent:user_1:agent_1:operation:manual:' + NOW + ':manual-' + NOW,
    );
  });

  it('builds an agent.user.message event without requiring an agent', () => {
    const event = buildTriggerSourceEvent({
      now: NOW,
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
      userId,
    });

    const payload = event.payload as Record<string, unknown>;
    expect(payload.message).toBe('Manual agent.user.message trigger');
    expect(payload.messageId).toBe(`manual-${NOW}`);
    // userId is injected to keep scope-key fallback owner-scoped.
    expect(payload.userId).toBe(userId);
  });

  it.each([
    [AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted, 'succeeded'],
    [AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed, 'failed'],
  ])('builds a %s event with status %s', (sourceType, status) => {
    const event = buildTriggerSourceEvent({ agentId, now: NOW, sourceType, userId });
    const payload = event.payload as { outcome: { status: string }; tool: { identifier: string } };
    expect(payload.outcome.status).toBe(status);
    expect(payload.tool.identifier).toBe('manual-trigger');
  });

  it('throws a clear error when agentId is missing for agent-scoped types', () => {
    expect(() =>
      buildTriggerSourceEvent({
        now: NOW,
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
        userId,
      }),
    ).toThrow(/agentId is required/);
  });

  it('merges payload overrides but never lets them repoint userId', () => {
    const event = buildTriggerSourceEvent({
      agentId,
      now: NOW,
      payloadOverride: { timezone: 'Asia/Shanghai', userId: 'attacker' },
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
      userId,
    });

    const payload = event.payload as Record<string, unknown>;
    expect(payload.timezone).toBe('Asia/Shanghai');
    expect(payload.userId).toBe(userId);
  });

  it('honors an explicit sourceId / scopeKey / timestamp override', () => {
    const event = buildTriggerSourceEvent({
      agentId,
      now: NOW,
      scopeKey: 'agent:agent_1:user:user_1',
      sourceId: 'custom-source-id',
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentNightlyReviewRequested,
      timestamp: 123,
      userId,
    });

    expect(event.sourceId).toBe('custom-source-id');
    expect(event.scopeKey).toBe('agent:agent_1:user:user_1');
    expect(event.timestamp).toBe(123);
  });
});
