import { describe, expect, it } from 'vitest';

import { toAgentSignalTraceEvents } from '../traceEvents';

describe('toAgentSignalTraceEvents', () => {
  /**
   * @example
   * const events = toAgentSignalTraceEvents({
   *   source,
   *   signals: [],
   *   actions: [action],
   *   results: [
   *     {
   *       actionId: 'a1',
   *       attempt: { current: 1, startedAt: 1, status: 'succeeded' },
   *       status: 'applied',
   *     },
   *   ],
   * });
   * expect(events.map((event) => event.type)).toEqual(['agent_signal.source', 'agent_signal.action', 'agent_signal.result']);
   */
  it('formats compact runtime events for tracing systems', () => {
    const events = toAgentSignalTraceEvents({
      actions: [
        {
          actionId: 'action_1',
          actionType: 'action.sample.handle',
          chain: { chainId: 'chain_1', parentNodeId: 'signal_1', rootSourceId: 'source_1' },
          payload: { message: 'remember this' },
          signal: {
            signalId: 'signal_1',
            signalType: 'signal.sample.accepted',
          },
          source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
          timestamp: 3,
        },
      ],
      results: [
        {
          actionId: 'action_1',
          attempt: { completedAt: 5, current: 1, startedAt: 4, status: 'succeeded' },
          output: { decision: { action: 'create' } },
          status: 'applied',
        },
      ],
      signals: [],
      source: {
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: { message: 'remember this', messageId: 'msg_1' },
        scopeKey: 'topic:t1',
        sourceId: 'source_1',
        sourceType: 'agent.user.message',
        timestamp: 1,
      },
    });

    expect(events.map((event) => event.type)).toEqual([
      'agent_signal.source',
      'agent_signal.action',
      'agent_signal.result',
    ]);
    expect(events.at(-1)?.data).toEqual(
      expect.objectContaining({
        attemptCurrent: 1,
        attemptStatus: 'succeeded',
        outputDecision: { action: 'create' },
      }),
    );
  });

  /**
   * @example
   * const failed = toAgentSignalTraceEvents({ results: [{ status: 'failed', error: { message: 'boom' } }] });
   * expect(failed.at(-1)?.data.errorMessage).toBe('boom');
   */
  it('keeps failed action error messages in trace events', () => {
    const events = toAgentSignalTraceEvents({
      actions: [],
      results: [
        {
          actionId: 'action_failed',
          attempt: { completedAt: 5, current: 1, startedAt: 4, status: 'failed' },
          error: {
            code: 'SKILL_MANAGEMENT_EXECUTION_FAILED',
            message: 'model output did not match schema',
          },
          status: 'failed',
        },
      ],
      signals: [],
      source: {
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: { message: 'remember this', messageId: 'msg_1' },
        scopeKey: 'topic:t1',
        sourceId: 'source_1',
        sourceType: 'agent.user.message',
        timestamp: 1,
      },
    });

    expect(events.at(-1)?.data).toEqual(
      expect.objectContaining({
        errorCode: 'SKILL_MANAGEMENT_EXECUTION_FAILED',
        errorMessage: 'model output did not match schema',
      }),
    );
  });

  /**
   * @example
   * const event = toAgentSignalTraceEvents({ signals: [{ payload: { result: 'satisfied' } }] }).at(1);
   * expect(event?.data.satisfactionResult).toBe('satisfied');
   */
  it('copies classifier signal payload summaries into trace events', () => {
    const events = toAgentSignalTraceEvents({
      actions: [],
      results: [],
      signals: [
        {
          chain: { chainId: 'chain_1', parentNodeId: 'source_1', rootSourceId: 'source_1' },
          payload: {
            confidence: 0.86,
            reason: 'implicit but strong future skill-learning instruction',
            result: 'not_satisfied',
            target: 'skill',
          },
          signalId: 'signal_1',
          signalType: 'signal.feedback.domain.skill',
          source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
          timestamp: 2,
        },
      ],
      source: {
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: { message: 'remember this', messageId: 'msg_1' },
        scopeKey: 'topic:t1',
        sourceId: 'source_1',
        sourceType: 'agent.user.message',
        timestamp: 1,
      },
    });

    expect(events.at(1)?.data).toEqual(
      expect.objectContaining({
        confidence: 0.86,
        reason: 'implicit but strong future skill-learning instruction',
        satisfactionResult: 'not_satisfied',
        target: 'skill',
      }),
    );
  });

  /**
   * @example
   * skill domain signal trace includes compact route and classifier fields.
   */
  it('projects skill intent classifier fields on signal trace events', () => {
    const source = {
      chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
      payload: { message: 'remember this', messageId: 'msg_1' },
      scopeKey: 'topic:t1',
      sourceId: 'source_1',
      sourceType: 'agent.user.message' as const,
      timestamp: 1,
    };
    const events = toAgentSignalTraceEvents({
      actions: [],
      results: [],
      signals: [
        {
          chain: { chainId: 'chain_1', parentNodeId: 'sig_parent', rootSourceId: 'source_1' },
          payload: {
            confidence: 0.9,
            evidence: [
              { cue: 'future reuse', excerpt: 'follow the review checklist from earlier' },
            ],
            message: 'For future database migration reviews, follow the checklist from earlier.',
            messageId: 'msg_1',
            reason: 'skill-domain target',
            satisfactionResult: 'satisfied',
            skillActionIntent: 'create',
            skillIntentError: {
              cause: 'HTTP 401 unauthorized',
              message: 'provider returned invalid key: [redacted-key]',
              name: 'Error',
            },
            skillIntentConfidence: 0.86,
            skillIntentExplicitness: 'implicit_strong_learning',
            skillIntentReason: 'future-scoped procedural reuse instruction',
            skillRoute: 'direct_decision',
            target: 'skill',
          },
          signalId: 'sig_skill',
          signalType: 'signal.feedback.domain.skill',
          source,
          timestamp: 102,
        },
      ],
      source,
    });

    expect(events[1]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          classifierConfidence: 0.86,
          classifierError: {
            cause: 'HTTP 401 unauthorized',
            message: 'provider returned invalid key: [redacted-key]',
            name: 'Error',
          },
          classifierReason: 'future-scoped procedural reuse instruction',
          satisfactionResult: 'satisfied',
          signalId: 'sig_skill',
          skillActionIntent: 'create',
          skillIntentExplicitness: 'implicit_strong_learning',
          skillRoute: 'direct_decision',
          target: 'skill',
        }),
        type: 'agent_signal.signal',
      }),
    );
  });
});
