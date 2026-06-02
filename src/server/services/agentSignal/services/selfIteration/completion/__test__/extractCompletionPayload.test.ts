import { MemoryApiName, MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import { describe, expect, it } from 'vitest';

import { extractSelfIterationCompletionPayload } from '../extractCompletionPayload';

const toolMessage = (apiName: string, kind: string, data: Record<string, unknown>) => ({
  apiName,
  content: JSON.stringify({ kind, ...data }),
  role: 'tool',
  tool_call_id: `${apiName}_call`,
});

const buildState = (metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  messages: [],
  metadata,
  ...extra,
});

const reviewMetadata = {
  agentId: 'agent_user_1',
  agentSignal: { kind: 'nightly-review', sourceId: 'src_1' },
  userId: 'user_1',
};

describe('extractSelfIterationCompletionPayload', () => {
  it('returns undefined for an unmarked run', () => {
    expect(
      extractSelfIterationCompletionPayload(buildState({ agentId: 'agent_x', userId: 'user_1' })),
    ).toBeUndefined();
  });

  it('returns undefined without a userId', () => {
    expect(
      extractSelfIterationCompletionPayload(
        buildState({ agentId: 'agent_x', agentSignal: { kind: 'nightly-review' } }),
      ),
    ).toBeUndefined();
  });

  it('extracts via the marker even for a user agent (no self-iteration slug)', () => {
    const result = extractSelfIterationCompletionPayload(
      buildState(reviewMetadata, {
        messages: [
          toolMessage('createSelfReviewProposal', 'mutation', { proposalId: 'brf_1' }),
          toolMessage('recordSelfReviewIdea', 'artifact', { idea: 'x' }),
        ],
      }),
    );

    expect(result?.marker.kind).toBe('nightly-review');
    expect(result?.userId).toBe('user_1');
    expect(result?.mutations).toHaveLength(1);
    expect(result?.mutations[0].apiName).toBe('createSelfReviewProposal');
    expect(result?.artifacts).toHaveLength(1);
  });

  it('synthesizes a writeMemory mutation for a memory-kind run from finalState usage', () => {
    const result = extractSelfIterationCompletionPayload(
      buildState(
        {
          agentId: 'agent_user_1',
          agentSignal: { kind: 'memory', sourceId: 'mem-src_1' },
          userId: 'user_1',
        },
        {
          status: 'finished',
          usage: {
            tools: {
              byTool: [
                {
                  calls: 1,
                  errors: 0,
                  name: `${MemoryIdentifier}/${MemoryApiName.addPreferenceMemory}`,
                },
              ],
            },
          },
        },
      ),
    );

    expect(result?.marker.kind).toBe('memory');
    expect(result?.artifacts).toHaveLength(0);
    expect(result?.mutations).toHaveLength(1);
    expect(result?.mutations[0].apiName).toBe('writeMemory');
    expect((result?.mutations[0].data as { status?: string }).status).toBe('applied');
  });

  it('yields no memory mutation when the memory run did not apply a write', () => {
    const result = extractSelfIterationCompletionPayload(
      buildState(
        {
          agentId: 'agent_user_1',
          agentSignal: { kind: 'memory', sourceId: 'mem-src_2' },
          userId: 'user_1',
        },
        { status: 'finished', usage: { tools: { byTool: [] } } },
      ),
    );

    expect(result?.marker.kind).toBe('memory');
    expect(result?.mutations).toHaveLength(0);
  });
});
