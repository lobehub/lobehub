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
});
