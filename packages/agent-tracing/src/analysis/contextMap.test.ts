import { describe, expect, it } from 'vitest';

import type { ExecutionSnapshot } from '../types';
import { buildContextMap } from './contextMap';

const snapshot = (steps: any[], extra: Partial<ExecutionSnapshot> = {}): ExecutionSnapshot =>
  ({
    operationId: 'op_test',
    startedAt: 0,
    steps,
    totalCost: 0,
    totalSteps: steps.length,
    totalTokens: 0,
    traceId: 't',
    ...extra,
  }) as ExecutionSnapshot;

const sys = (content: string) => ({ content, role: 'system' });
const user = (content: string) => ({ content, role: 'user' });

describe('buildContextMap', () => {
  it('splits an assistant message into reasoning, content and tool-call segments', () => {
    const map = buildContextMap(
      snapshot([
        {
          contextEngine: {
            output: [
              sys('you are a helpful agent'),
              {
                content: 'let me look that up',
                reasoning: 'the user wants the weather',
                role: 'assistant',
                tool_calls: [{ function: { arguments: '{}', name: 'getWeather' }, id: 'c1' }],
              },
            ],
          },
          messagesBaseline: [],
          stepIndex: 0,
          stepType: 'call_llm',
        },
      ]),
    );

    expect(map.calls).toHaveLength(1);
    const kinds = map.calls[0].segments.map((s) => s.kind);
    expect(kinds).toEqual(['system', 'reasoning', 'assistant', 'tool_call']);
    // all three assistant segments point back at the same payload message, and share its role
    expect(map.calls[0].segments.slice(1).every((s) => s.messageIndex === 1)).toBe(true);
    expect(map.calls[0].segments.map((s) => s.role)).toEqual([
      'system',
      'assistant',
      'assistant',
      'assistant',
    ]);
    expect(map.calls[0].segments.at(-1)!.label).toBe('getWeather');
  });

  it('tags injected blocks with the user role that carried them', () => {
    const map = buildContextMap(
      snapshot([
        {
          contextEngine: {
            output: [
              sys('role'),
              user('<agent_documents_index>\n3 docs'),
              { content: 'ok', name: 'search', role: 'tool', tool_call_id: 'c1' },
            ],
          },
          messagesBaseline: [],
          stepIndex: 0,
          stepType: 'call_llm',
        },
      ]),
    );

    expect(map.calls[0].segments.map((s) => [s.kind, s.role])).toEqual([
      ['system', 'system'],
      ['injected', 'user'],
      ['tool_result', 'tool'],
    ]);
  });

  it('marks a payload message with no DB counterpart as an injected block', () => {
    const map = buildContextMap(
      snapshot([
        {
          contextEngine: {
            output: [sys('role'), user('<agent_documents_index>\n3 docs'), user('hello there')],
          },
          messagesBaseline: [user('hello there')],
          stepIndex: 0,
          stepType: 'call_llm',
        },
      ]),
    );

    const [, injected, real] = map.calls[0].segments;
    expect(injected.kind).toBe('injected');
    expect(injected.label).toBe('<agent_documents_index>');
    expect(real.kind).toBe('user');
  });

  it('keeps the prefix intact when a payload only grows at the end', () => {
    const first = [sys('role'), user('hello')];
    const map = buildContextMap(
      snapshot([
        {
          contextEngine: { output: first },
          messagesBaseline: [],
          stepIndex: 0,
          stepType: 'call_llm',
        },
        {
          contextEngine: { output: [...first, { content: 'hi', role: 'assistant' }] },
          stepIndex: 1,
          stepType: 'call_llm',
        },
      ]),
    );

    expect(map.calls[1].breakMessageIndex).toBeUndefined();
    expect(map.calls[1].stablePrefixMessages).toBe(2);
    expect(map.calls[1].cachedTokens).toBe(map.calls[0].totalTokens);
    expect(map.summary.brokenPrefixCalls).toBe(0);
  });

  it('attributes a broken prefix to the mutated message and counts the unchanged tail', () => {
    const tail = { content: 'a stable assistant answer', role: 'assistant' };
    const map = buildContextMap(
      snapshot([
        {
          contextEngine: { output: [sys('role'), user('docs updated 1m ago'), tail] },
          messagesBaseline: [],
          stepIndex: 0,
          stepType: 'call_llm',
        },
        {
          // only the injected block changed — the tail behind it is byte-identical
          contextEngine: { output: [sys('role'), user('docs updated just now'), tail] },
          stepIndex: 1,
          stepType: 'call_llm',
        },
      ]),
    );

    const second = map.calls[1];
    expect(second.breakMessageIndex).toBe(1);
    expect(second.breakReason).toContain('injected block');
    expect(second.wastedTokens).toBeGreaterThan(0);
    expect(second.reprocessedTokens).toBe(second.totalTokens - second.cachedTokens);
    expect(map.summary.brokenPrefixCalls).toBe(1);
  });

  it('names a compression reset instead of blaming the rewritten message', () => {
    const map = buildContextMap(
      snapshot([
        {
          contextEngine: { output: [sys('role'), user('turn one'), user('turn two')] },
          messagesBaseline: [],
          stepIndex: 0,
          stepType: 'call_llm',
        },
        {
          contextEngine: { output: [sys('role'), user('<compressed_history_summary>\nrecap')] },
          isCompressionReset: true,
          stepIndex: 1,
          stepType: 'call_llm',
        },
      ]),
    );

    expect(map.calls[1].breakReason).toBe('context compression reset');
  });

  it('still names the reset when the compressed history only reaches the next call', () => {
    const map = buildContextMap(
      snapshot([
        {
          contextEngine: { output: [sys('role'), user('turn one'), user('turn two')] },
          messagesBaseline: [],
          stepIndex: 0,
          stepType: 'call_llm',
        },
        // compression happens here, but this call still ran on the pre-compression payload
        {
          contextEngine: {},
          isCompressionReset: true,
          stepIndex: 1,
          stepType: 'call_llm',
        },
        {
          contextEngine: { output: [sys('role'), user('<compressed_history_summary>\nrecap')] },
          stepIndex: 2,
          stepType: 'call_llm',
        },
      ]),
    );

    expect(map.calls[2].breakReason).toBe('context compression reset');
  });

  it('reports composition of the final call rather than the sum of every call', () => {
    const map = buildContextMap(
      snapshot([
        {
          contextEngine: { output: [sys('role')] },
          messagesBaseline: [],
          stepIndex: 0,
          stepType: 'call_llm',
        },
        {
          contextEngine: { output: [sys('role'), user('hello')] },
          stepIndex: 1,
          stepType: 'call_llm',
        },
      ]),
    );

    const finalCall = map.calls.at(-1)!;
    const totalKindTokens = Object.values(map.summary.kindTokens).reduce((a, b) => a + b, 0);
    expect(totalKindTokens).toBe(finalCall.totalTokens);
  });

  it('returns an empty map when no payload was recorded', () => {
    const map = buildContextMap(snapshot([{ stepIndex: 0, stepType: 'call_tool' }]));
    expect(map.calls).toEqual([]);
    expect(map.payloadSource).toBe('none');
    expect(map.summary.llmCalls).toBe(0);
  });
});
