import { describe, expect, it, vi } from 'vitest';

const {
  actionCounterAdd,
  actionDurationRecord,
  actionResultCounterAdd,
  chainCounterAdd,
  chainDurationRecord,
  signalCounterAdd,
  signalTransitionCounterAdd,
  sourceCounterAdd,
  spanAddEvent,
  spanEnd,
  spanSetAttribute,
  startActiveSpan,
} = vi.hoisted(() => {
  const actionCounterAdd = vi.fn();
  const actionDurationRecord = vi.fn();
  const actionResultCounterAdd = vi.fn();
  const chainCounterAdd = vi.fn();
  const chainDurationRecord = vi.fn();
  const signalCounterAdd = vi.fn();
  const signalTransitionCounterAdd = vi.fn();
  const sourceCounterAdd = vi.fn();
  const spanAddEvent = vi.fn();
  const spanEnd = vi.fn();
  const spanSetAttribute = vi.fn();
  const startActiveSpan = vi.fn(async (_name: string, _options: unknown, callback: any) => {
    return callback({
      addEvent: spanAddEvent,
      end: spanEnd,
      setAttribute: spanSetAttribute,
    });
  });

  return {
    actionCounterAdd,
    actionDurationRecord,
    actionResultCounterAdd,
    chainCounterAdd,
    chainDurationRecord,
    signalCounterAdd,
    signalTransitionCounterAdd,
    sourceCounterAdd,
    spanAddEvent,
    spanEnd,
    spanSetAttribute,
    startActiveSpan,
  };
});

vi.mock('@lobechat/observability-otel/modules/agent-signal', () => ({
  actionCounter: { add: actionCounterAdd },
  actionDurationHistogram: { record: actionDurationRecord },
  actionResultCounter: { add: actionResultCounterAdd },
  chainCounter: { add: chainCounterAdd },
  chainDurationHistogram: { record: chainDurationRecord },
  signalActionTransitionCounter: { add: signalTransitionCounterAdd },
  signalCounter: { add: signalCounterAdd },
  sourceCounter: { add: sourceCounterAdd },
  tracer: {
    startActiveSpan,
  },
}));

describe('persistAgentSignalObservability', () => {
  /**
   * @example
   * await persistAgentSignalObservability(projection);
   * expect(spanAddEvent).toHaveBeenCalledWith('agent_signal.source', expect.any(Object), expect.any(Number));
   */
  it('emits OTEL span events and metrics for one projected chain', async () => {
    const { persistAgentSignalObservability } = await import('../store');

    await persistAgentSignalObservability({
      envelope: {
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
        chainId: 'chain_1',
        edges: [],
        handlerRuns: [
          {
            attempt: { completedAt: 5, current: 1, startedAt: 4, status: 'succeeded' },
            handlerType: 'action.sample.handle',
            id: 'action_1:attempt:1',
            inputRefIds: ['signal_1'],
            outputRefIds: ['action_1:result'],
            startedAt: '2026-04-22T00:00:00.000Z',
            status: 'ok',
          },
        ],
        metadata: { agentId: 'agent_1', operationId: 'op_1', scopeKey: 'topic:t1', topicId: 't1' },
        rootSourceId: 'source_1',
        results: [
          {
            actionId: 'action_1',
            attempt: { completedAt: 5, current: 1, startedAt: 4, status: 'succeeded' },
            status: 'applied',
          },
        ],
        signals: [
          {
            chain: { chainId: 'chain_1', parentNodeId: 'source_1', rootSourceId: 'source_1' },
            payload: { intents: ['memory'], message: 'remember this', messageId: 'msg_1' },
            signalId: 'signal_1',
            signalType: 'signal.sample.accepted',
            source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
            timestamp: 2,
          },
        ],
        source: {
          chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
          payload: {
            agentId: 'agent_1',
            message: 'remember this',
            messageId: 'msg_1',
            topicId: 't1',
          },
          scopeKey: 'topic:t1',
          sourceId: 'source_1',
          sourceType: 'agent.user.message',
          timestamp: 1,
        },
        traceId: 'trace_1',
        version: 1,
      },
      record: {
        agentId: 'agent_1',
        chainId: 'chain_1',
        conclusionChain: {
          compressedSignals: {},
          dominantPath: ['agent.user.message', 'signal.sample.accepted'],
        },
        createdAt: '2026-04-22T00:00:00.000Z',
        finalActionId: 'action_1',
        finalActionType: 'action.sample.handle',
        finalStatus: 'applied',
        id: 'telemetry_1',
        operationId: 'op_1',
        rootSourceId: 'source_1',
        scopeKey: 'topic:t1',
        sourceId: 'source_1',
        sourceType: 'agent.user.message',
        durationMs: 6,
        summary: {
          attemptBreakdown: {
            failed: 0,
            retriableFailures: 0,
            skipped: 0,
            succeeded: 1,
            total: 1,
          },
          domains: ['sample'],
          outcomes: ['accepted'],
          statusBreakdown: { applied: 1, failed: 0, skipped: 0 },
          totalActions: 1,
          totalSignals: 1,
        },
        topicId: 't1',
      },
    });

    expect(startActiveSpan).toHaveBeenCalledWith(
      'agent_signal.observe',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'agent.signal.chain_id': 'chain_1',
          'agent.signal.source_type': 'agent.user.message',
        }),
      }),
      expect.any(Function),
    );
    expect(spanAddEvent).toHaveBeenCalledWith(
      'agent_signal.source',
      expect.objectContaining({
        sourceId: 'source_1',
      }),
      1,
    );
    expect(spanAddEvent).toHaveBeenCalledWith(
      'agent_signal.result',
      expect.objectContaining({
        actionId: 'action_1',
        attemptCurrent: 1,
      }),
      3,
    );
    expect(sourceCounterAdd).toHaveBeenCalledWith(1, {
      'agent.signal.source_type': 'agent.user.message',
    });
    expect(signalCounterAdd).toHaveBeenCalledWith(1, {
      'agent.signal.signal_domain': 'sample',
      'agent.signal.signal_outcome': 'accepted',
      'agent.signal.signal_type': 'signal.sample.accepted',
      'agent.signal.source_type': 'agent.user.message',
    });
    expect(actionCounterAdd).toHaveBeenCalledWith(1, {
      'agent.signal.action_type': 'action.sample.handle',
    });
    expect(actionResultCounterAdd).toHaveBeenCalledWith(1, {
      'agent.signal.action_type': 'action.sample.handle',
      'agent.signal.result_status': 'applied',
    });
    expect(signalTransitionCounterAdd).toHaveBeenCalledWith(1, {
      'agent.signal.action_type': 'action.sample.handle',
      'agent.signal.signal_domain': 'sample',
      'agent.signal.signal_outcome': 'accepted',
      'agent.signal.signal_type': 'signal.sample.accepted',
    });
    expect(chainCounterAdd).toHaveBeenCalledWith(1, {
      'agent.signal.final_status': 'applied',
      'agent.signal.source_type': 'agent.user.message',
    });
    expect(actionDurationRecord).toHaveBeenCalledWith(1, {
      'agent.signal.action_type': 'action.sample.handle',
      'agent.signal.result_status': 'applied',
    });
    expect(chainDurationRecord).toHaveBeenCalledWith(6, {
      'agent.signal.final_status': 'applied',
      'agent.signal.source_type': 'agent.user.message',
    });
    expect(spanSetAttribute).toHaveBeenCalledWith('agent.signal.total_attempts', 1);
    expect(spanEnd).toHaveBeenCalled();
  });
});
