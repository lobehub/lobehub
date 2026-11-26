import { describe, expect, it, vi } from 'vitest';

// The request enum is read from this service; stubbing it keeps the test off
// the agent-signal service graph.
vi.mock('@/server/services/agentSignal/triggerSourceEvent', () => ({
  AGENT_SIGNAL_TRIGGER_SOURCE_TYPES: ['manual'],
}));

const { AgentSignalEmissionSchema, AgentSignalReceiptListSchema } =
  await import('./agent-signal.type');

describe('agent signal response schemas', () => {
  it('accepts an accepted and a dropped emission', () => {
    expect(() =>
      AgentSignalEmissionSchema.parse({ accepted: true, scopeKey: 'topic:t', workflowRunId: 'r' }),
    ).not.toThrow();
    expect(() =>
      AgentSignalEmissionSchema.parse({ accepted: false, scopeKey: 'topic:t', workflowRunId: '' }),
    ).not.toThrow();
  });

  it('accepts a receipt page', () => {
    const page = {
      cursor: 20,
      receipts: [
        {
          agentId: 'agt-1',
          createdAt: 1_763_366_400_000,
          detail: 'Saved a preference',
          id: 'rcp-1',
          kind: 'memory',
          metadata: {
            actionType: 'write_memory',
            evidenceRefs: [{ id: 'msg-1', type: 'message' }],
          },
          sourceId: 'src-1',
          sourceType: 'agent.user.message',
          status: 'applied',
          target: { memoryLayer: 'preference', operation: 'create', type: 'memory' },
          title: 'Memory updated',
          topicId: 'tpc-1',
          userId: 'user-1',
        },
      ],
    };

    expect(() => AgentSignalReceiptListSchema.parse(page)).not.toThrow();
  });
});
