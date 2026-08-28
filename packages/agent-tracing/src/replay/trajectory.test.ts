import { describe, expect, it } from 'vitest';

import type { ExecutionSnapshot } from '../types';
import {
  buildToolMessages,
  findChainAnchor,
  listFrozenCalls,
  recordedAssistantTurn,
  recordedOutcome,
  recordedToolResults,
  toolSignature,
} from './trajectory';

const snapshot = (steps: Partial<ExecutionSnapshot['steps'][number]>[]): ExecutionSnapshot =>
  ({
    completedAt: 2,
    operationId: 'op_1_agt_a_tpc_b_c',
    startedAt: 1,
    steps: steps.map((step, index) => ({
      completedAt: 2,
      executionTimeMs: 1,
      startedAt: 1,
      stepIndex: index,
      stepType: 'call_llm',
      totalCost: 0,
      totalTokens: 0,
      ...step,
    })),
    totalCost: 0,
    totalSteps: steps.length,
    totalTokens: 0,
    traceId: 't',
  }) as ExecutionSnapshot;

describe('listFrozenCalls', () => {
  it('returns one node per call_llm step, skipping tool steps', () => {
    const snap = snapshot([
      { contextEngine: { output: [{ content: 'a', role: 'user' }] } },
      { stepType: 'call_tool' },
      { contextEngine: { output: [{ content: 'b', role: 'user' }] } },
    ]);

    expect(listFrozenCalls(snap).map((call) => call.stepIndex)).toEqual([0, 2]);
  });
});

describe('recordedOutcome', () => {
  it('composes tool names as identifier____apiName', () => {
    const snap = snapshot([
      {
        content: 'let me look',
        toolsCalling: [{ apiName: 'globFiles', identifier: 'lobe-local-system' }],
      },
    ]);

    expect(recordedOutcome(snap, 0)).toEqual({
      content: 'let me look',
      toolCalls: [{ arguments: undefined, name: 'lobe-local-system____globFiles' }],
    });
  });

  it('reports an empty outcome for a step with no output', () => {
    expect(recordedOutcome(snapshot([{}]), 0)).toEqual({ content: '', toolCalls: [] });
  });
});

describe('recordedToolResults', () => {
  it('collects the tool steps between this node and the next call_llm', () => {
    const snap = snapshot([
      {},
      {
        stepType: 'call_tool',
        toolsResult: [{ apiName: 'readFile', identifier: 'fs', output: 'one' }],
      },
      {
        stepType: 'call_tool',
        toolsResult: [{ apiName: 'globFiles', identifier: 'fs', output: 'two' }],
      },
      {},
      {
        stepType: 'call_tool',
        toolsResult: [{ apiName: 'readFile', identifier: 'fs', output: 'later' }],
      },
    ]);

    expect(recordedToolResults(snap, 0)).toEqual([
      { name: 'fs____readFile', output: 'one' },
      { name: 'fs____globFiles', output: 'two' },
    ]);
  });
});

describe('toolSignature', () => {
  it('compares the sequence of tools, not their arguments', () => {
    expect(toolSignature([{ name: 'a' }, { name: 'b' }])).toBe('a → b');
    expect(toolSignature([{ name: 'b' }, { name: 'a' }])).not.toBe(
      toolSignature([{ name: 'a' }, { name: 'b' }]),
    );
  });

  it('treats a terminal answer as an empty signature', () => {
    expect(toolSignature([])).toBe('');
  });
});

describe('buildToolMessages', () => {
  const results = [
    { name: 'fs____readFile', output: 'first' },
    { name: 'fs____readFile', output: 'second' },
  ];

  it('pairs repeated calls with recorded results in order', () => {
    const { messages, unmatched } = buildToolMessages(
      [
        { id: 'c1', name: 'fs____readFile' },
        { id: 'c2', name: 'fs____readFile' },
      ],
      results,
    );

    expect(unmatched).toEqual([]);
    expect(messages).toEqual([
      { content: 'first', name: 'fs____readFile', role: 'tool', tool_call_id: 'c1' },
      { content: 'second', name: 'fs____readFile', role: 'tool', tool_call_id: 'c2' },
    ]);
  });

  it('reports a call the recording cannot answer instead of inventing output', () => {
    const { messages, unmatched } = buildToolMessages(
      [{ id: 'c1', name: 'fs____writeFile' }],
      results,
    );

    expect(messages).toEqual([]);
    expect(unmatched).toEqual(['fs____writeFile']);
  });

  it('runs out of results when the model calls a tool more often than the recording did', () => {
    const { messages, unmatched } = buildToolMessages(
      [
        { id: 'c1', name: 'fs____readFile' },
        { id: 'c2', name: 'fs____readFile' },
        { id: 'c3', name: 'fs____readFile' },
      ],
      results,
    );

    expect(messages).toHaveLength(2);
    expect(unmatched).toEqual(['fs____readFile']);
  });

  const recordedWithArgs = [
    { arguments: '{"path":"a"}', name: 'fs____readFile', output: 'BODY OF A' },
  ];

  it('refuses to answer a call whose arguments the recording never ran', () => {
    // Same tool, different file: feeding back the output recorded for "a" would
    // let the chain continue on a premise the recorded run never established.
    const { messages, unmatched } = buildToolMessages(
      [{ arguments: '{"path":"b"}', id: 'c1', name: 'fs____readFile' }],
      recordedWithArgs,
    );

    expect(messages).toEqual([]);
    expect(unmatched).toEqual(['fs____readFile']);
  });

  it('matches arguments regardless of key order and whitespace', () => {
    const { messages, unmatched } = buildToolMessages(
      [{ arguments: '{ "path" : "a" }', id: 'c1', name: 'fs____readFile' }],
      [{ arguments: '{"path":"a"}', name: 'fs____readFile', output: 'BODY OF A' }],
    );

    expect(unmatched).toEqual([]);
    expect(messages[0].content).toBe('BODY OF A');
  });

  it('picks the recorded result whose arguments match, not merely the first by name', () => {
    const { messages } = buildToolMessages(
      [{ arguments: '{"path":"b"}', id: 'c1', name: 'fs____readFile' }],
      [
        { arguments: '{"path":"a"}', name: 'fs____readFile', output: 'BODY OF A' },
        { arguments: '{"path":"b"}', name: 'fs____readFile', output: 'BODY OF B' },
      ],
    );

    expect(messages[0].content).toBe('BODY OF B');
  });

  it('still matches by name for traces recorded before arguments were paired on', () => {
    const { messages, unmatched } = buildToolMessages(
      [{ arguments: '{"path":"anything"}', id: 'c1', name: 'fs____readFile' }],
      results,
    );

    expect(unmatched).toEqual([]);
    expect(messages[0].content).toBe('first');
  });
});

describe('recordedToolResults', () => {
  it('carries the arguments of the call each result answers', () => {
    const snap = snapshot([
      {
        toolsCalling: [
          { apiName: 'readFile', arguments: '{"path":"a"}', identifier: 'fs' },
          { apiName: 'readFile', arguments: '{"path":"b"}', identifier: 'fs' },
        ],
      },
      {
        stepType: 'call_tool',
        toolsResult: [
          { apiName: 'readFile', identifier: 'fs', output: 'BODY OF A' },
          { apiName: 'readFile', identifier: 'fs', output: 'BODY OF B' },
        ],
      },
    ]);

    expect(recordedToolResults(snap, 0)).toEqual([
      { arguments: '{"path":"a"}', name: 'fs____readFile', output: 'BODY OF A' },
      { arguments: '{"path":"b"}', name: 'fs____readFile', output: 'BODY OF B' },
    ]);
  });
});

describe('findChainAnchor', () => {
  const assistantA = { content: 'first turn', role: 'assistant' };
  const assistantB = { content: 'second turn', role: 'assistant' };

  it('anchors at the earliest recorded assistant turn still in the payload', () => {
    const payload = [
      { content: 'system', role: 'system' },
      { content: 'injected block', role: 'user' },
      assistantA,
      { content: 'result', role: 'tool' },
      assistantB,
    ];

    expect(findChainAnchor(payload, [assistantA, assistantB])).toEqual({ index: 2, nodeOffset: 0 });
  });

  it('falls forward to a later node when the earliest turn was compressed away', () => {
    const payload = [{ content: 'summary', role: 'user' }, assistantB];

    expect(findChainAnchor(payload, [assistantA, assistantB])).toEqual({ index: 1, nodeOffset: 1 });
  });

  it('returns undefined when no recorded turn survives in the payload', () => {
    expect(findChainAnchor([{ content: 'summary', role: 'user' }], [assistantA])).toBeUndefined();
  });

  it('distinguishes assistant turns that differ only by tool calls', () => {
    const withTools = { content: '', role: 'assistant', tool_calls: [{ id: 'x' }] };
    const withoutTools = { content: '', role: 'assistant' };

    expect(findChainAnchor([withoutTools], [withTools])).toBeUndefined();
    expect(findChainAnchor([withTools], [withTools])).toEqual({ index: 0, nodeOffset: 0 });
  });
});

describe('recordedAssistantTurn', () => {
  it('reads the assistant message the step appended', () => {
    const snap = snapshot([{ messagesDelta: [{ content: 'hi', role: 'assistant' }] as any }]);

    expect(recordedAssistantTurn(snap, 0)).toEqual({ content: 'hi', role: 'assistant' });
  });

  it('returns undefined for a step that appended no assistant message', () => {
    expect(recordedAssistantTurn(snapshot([{ messagesDelta: [] as any }]), 0)).toBeUndefined();
  });
});
