import { describe, expect, it } from 'vitest';

import type { ExecutionSnapshot } from '../types';
import { listFrozenCalls, recordedOutcome, toolSignature } from './trajectory';

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
