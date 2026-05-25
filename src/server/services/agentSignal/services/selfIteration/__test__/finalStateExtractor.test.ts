import type { AgentState } from '@lobechat/agent-runtime';
import { describe, expect, it } from 'vitest';

import { extractArtifacts, extractFromFinalState, extractMutations } from '../finalStateExtractor';

const buildState = (messages: unknown[]): AgentState =>
  ({
    messages,
  }) as never;

describe('extractFromFinalState', () => {
  it('returns matching results when kind is encoded inline in the content JSON', () => {
    const state = buildState([
      {
        apiName: 'writeMemory',
        content: JSON.stringify({ kind: 'mutation', memoryId: 'mem_1' }),
        role: 'tool',
        tool_call_id: 'call_1',
      },
      {
        apiName: 'recordIdea',
        content: JSON.stringify({ ideaId: 'idea_1', kind: 'artifact' }),
        role: 'tool',
        tool_call_id: 'call_2',
      },
    ]);

    const mutations = extractFromFinalState(state, 'mutation');

    expect(mutations).toEqual([
      {
        apiName: 'writeMemory',
        data: { kind: 'mutation', memoryId: 'mem_1' },
        kind: 'mutation',
        toolCallId: 'call_1',
      },
    ]);
  });

  it('falls back to pluginState.kind when content is not a JSON object', () => {
    const state = buildState([
      {
        content: 'Memory saved successfully',
        pluginState: { kind: 'mutation', memoryId: 'mem_2' },
        role: 'tool',
        tool_call_id: 'call_3',
      },
    ]);

    const result = extractFromFinalState(state, 'mutation');

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('mutation');
    expect(result[0].toolCallId).toBe('call_3');
  });

  it('skips messages with no kind, wrong kind, or non-tool role', () => {
    const state = buildState([
      { content: 'no kind here', role: 'tool', tool_call_id: 'a' },
      { content: JSON.stringify({ kind: 'read' }), role: 'tool', tool_call_id: 'b' },
      { content: JSON.stringify({ kind: 'mutation' }), role: 'assistant', tool_call_id: 'c' },
    ]);

    expect(extractFromFinalState(state, 'mutation')).toEqual([]);
  });

  it('returns an empty array when state.messages is missing', () => {
    expect(extractFromFinalState({} as AgentState, 'mutation')).toEqual([]);
  });

  it('preserves message order', () => {
    const state = buildState([
      { content: JSON.stringify({ id: 1, kind: 'artifact' }), role: 'tool' },
      { content: JSON.stringify({ id: 2, kind: 'artifact' }), role: 'tool' },
      { content: JSON.stringify({ id: 3, kind: 'mutation' }), role: 'tool' },
      { content: JSON.stringify({ id: 4, kind: 'artifact' }), role: 'tool' },
    ]);

    const artifacts = extractArtifacts(state);
    expect(artifacts.map((r) => (r.data as { id: number }).id)).toEqual([1, 2, 4]);
  });

  it('extractMutations / extractArtifacts are convenience wrappers', () => {
    const state = buildState([
      { content: JSON.stringify({ kind: 'mutation' }), role: 'tool' },
      { content: JSON.stringify({ kind: 'artifact' }), role: 'tool' },
    ]);

    expect(extractMutations(state)).toHaveLength(1);
    expect(extractArtifacts(state)).toHaveLength(1);
  });
});
