import { describe, expect, it } from 'vitest';

import type { ExecutionSnapshot } from '../types';
import { analyzeAgentSignal, renderAgentSignal } from './agentSignal';

describe('analyzeAgentSignal', () => {
  it('extracts source signal action and result events from snapshot steps', () => {
    const snapshot: ExecutionSnapshot = {
      completedAt: 4,
      operationId: 'op_test',
      startedAt: 1,
      steps: [
        {
          completedAt: 4,
          events: [
            {
              data: {
                rootSourceId: 'src_1',
                scopeKey: 'topic:tpc_1',
                sourceId: 'src_1',
                sourceType: 'client.runtime.complete',
              },
              timestamp: 2,
              type: 'agent_signal.source',
            },
            {
              data: {
                parentNodeId: 'src_1',
                signalId: 'sig_1',
                signalType: 'signal.user-feedback-analysis.feedback-accepted',
                sourceId: 'src_1',
              },
              timestamp: 3,
              type: 'agent_signal.signal',
            },
            {
              data: {
                actionId: 'act_1',
                actionType: 'action.user-memory.handle',
                parentNodeId: 'sig_1',
                signalId: 'sig_1',
              },
              timestamp: 4,
              type: 'agent_signal.action',
            },
            {
              data: {
                actionId: 'act_1',
                attemptCurrent: 1,
                attemptStatus: 'succeeded',
                status: 'applied',
              },
              timestamp: 5,
              type: 'agent_signal.result',
            },
          ],
          executionTimeMs: 3,
          startedAt: 1,
          stepIndex: 0,
          stepType: 'call_llm',
          totalCost: 0,
          totalTokens: 0,
        },
      ],
      totalCost: 0,
      totalSteps: 1,
      totalTokens: 0,
      traceId: 'trace_test',
    };

    const analysis = analyzeAgentSignal(snapshot);

    expect(analysis.sources).toHaveLength(1);
    expect(analysis.signals).toHaveLength(1);
    expect(analysis.actions).toHaveLength(1);
    expect(analysis.results).toHaveLength(1);
    expect(analysis.sources[0]?.scopeKey).toBe('topic:tpc_1');
    expect(analysis.signals[0]?.signalType).toBe('signal.user-feedback-analysis.feedback-accepted');
    expect(analysis.actions[0]?.actionType).toBe('action.user-memory.handle');
    expect(analysis.results[0]?.status).toBe('applied');
  });
});

describe('renderAgentSignal', () => {
  it('renders a compact timeline from extracted events', () => {
    const snapshot: ExecutionSnapshot = {
      completedAt: 4,
      operationId: 'op_test',
      startedAt: 1,
      steps: [
        {
          completedAt: 4,
          events: [
            {
              data: {
                rootSourceId: 'src_1',
                scopeKey: 'topic:tpc_1',
                sourceId: 'src_1',
                sourceType: 'client.runtime.complete',
              },
              timestamp: 2,
              type: 'agent_signal.source',
            },
          ],
          executionTimeMs: 3,
          startedAt: 1,
          stepIndex: 0,
          stepType: 'call_llm',
          totalCost: 0,
          totalTokens: 0,
        },
      ],
      totalCost: 0,
      totalSteps: 1,
      totalTokens: 0,
      traceId: 'trace_test',
    };

    const rendered = renderAgentSignal(snapshot);

    expect(rendered).toContain('Agent Signal');
    expect(rendered).toContain('topic:tpc_1');
    expect(rendered).toContain('client.runtime.complete');
  });
});
