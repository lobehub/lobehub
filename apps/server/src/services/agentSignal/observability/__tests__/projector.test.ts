import { describe, expect, it } from 'vitest';

import type { AgentSignalTelemetryRecord, AgentSignalTraceEnvelope } from '../types';

describe('AgentSignal observability contracts', () => {
  /**
   * @example
   * const record = { summary: { totalSignals: 1 } } satisfies AgentSignalTelemetryRecord;
   * expect(record.summary.totalSignals).toBe(1);
   */
  it('supports compact summary records with conclusion chains', () => {
    const record: AgentSignalTelemetryRecord = {
      chainId: 'chain_1',
      conclusionChain: {
        compressedSignals: {},
        dominantPath: ['agent.user.message', 'signal.sample.accepted'],
      },
      createdAt: '2026-04-21T00:00:00.000Z',
      id: 'telemetry_1',
      rootSourceId: 'source_1',
      scopeKey: 'topic:t1',
      sourceId: 'source_1',
      sourceType: 'agent.user.message',
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
    };

    expect(record.summary.totalSignals).toBe(1);
  });

  /**
   * @example
   * const envelope = { edges: [{ relation: 'produced' }] } satisfies AgentSignalTraceEnvelope;
   * expect(envelope.edges[0].relation).toBe('produced');
   */
  it('supports expanded trace envelopes with nodes and edges', () => {
    const envelope: AgentSignalTraceEnvelope = {
      actions: [],
      chainId: 'chain_1',
      edges: [{ from: 'source_1', relation: 'produced', to: 'signal_1' }],
      handlerRuns: [],
      rootSourceId: 'source_1',
      results: [],
      signals: [],
      source: {
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: { message: 'remember this', messageId: 'msg_1' },
        scopeKey: 'topic:t1',
        sourceId: 'source_1',
        sourceType: 'agent.user.message',
        timestamp: 1,
      },
      version: 1,
    };

    expect(envelope.edges[0].relation).toBe('produced');
  });
});
