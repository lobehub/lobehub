import { MemoryApiName, MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import { LayersEnum } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { extractSelfIterationCompletionPayload } from '../extractCompletionPayload';

// Real persisted shape: the agent runtime stores tool messages with only
// content/role/tool_call_id — there is NO message-level apiName in live runs.
// The tool runtime stamps apiName + kind INTO the content, so the extractor must
// recover apiName from there.
const toolMessage = (apiName: string, kind: string, data: Record<string, unknown>) => ({
  content: JSON.stringify({ apiName, kind, ...data }),
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

  it('synthesizes a writeMemory mutation with a preference target for a memory-kind run', () => {
    const result = extractSelfIterationCompletionPayload(
      buildState(
        {
          agentId: 'agent_user_1',
          agentSignal: { kind: 'memory', sourceId: 'mem-src_1' },
          userId: 'user_1',
        },
        {
          messages: [
            {
              id: 'msg_preference',
              role: 'assistant',
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({
                      summary: 'Prefer direct implementation with focused tests.',
                      title: 'Prefers direct implementation',
                      withPreference: {
                        conclusionDirectives: 'Prefer direct implementation with focused tests.',
                      },
                    }),
                    name: `${MemoryIdentifier}____${MemoryApiName.addPreferenceMemory}`,
                  },
                  id: 'call_preference',
                  type: 'function',
                },
              ],
            },
            {
              content:
                'Preference memory "Prefers direct implementation" saved with memoryId: "mem_1" and preferenceId: "pref_1"',
              role: 'tool',
              tool_call_id: 'call_preference',
            },
          ],
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
    expect((result?.mutations[0].data as { resourceId?: string }).resourceId).toBe('pref_1');
    expect((result?.mutations[0].data as { target?: Record<string, unknown> }).target).toEqual({
      id: 'pref_1',
      memoryId: 'mem_1',
      memoryLayer: LayersEnum.Preference,
      summary: 'Prefer direct implementation with focused tests.',
      title: 'Prefers direct implementation',
      type: 'memory',
    });
  });

  it('falls back to the successful memory tool api when finalState lacks tool call details', () => {
    const result = extractSelfIterationCompletionPayload(
      buildState(
        {
          agentId: 'agent_user_1',
          agentSignal: { kind: 'memory', sourceId: 'mem-src_fallback' },
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

    expect(result?.mutations).toHaveLength(1);
    expect((result?.mutations[0].data as { target?: Record<string, unknown> }).target).toEqual({
      memoryLayer: LayersEnum.Preference,
      title: 'Memory saved',
      type: 'memory',
    });
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
