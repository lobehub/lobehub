import { describe, expect, it } from 'vitest';

import type { ExecutionSnapshot } from '../types';
import {
  buildReplayRequest,
  extractCompletionText,
  extractToolCalls,
  listReplayableSteps,
  parseModelTargets,
  resolveStepTools,
  selectFrozenCall,
} from './payload';

const snapshot = (steps: Partial<ExecutionSnapshot['steps'][number]>[]): ExecutionSnapshot =>
  ({
    completedAt: 2,
    model: 'deepseek-v4-flash',
    operationId: 'op_1_agt_a_tpc_b_c',
    provider: 'lobehub',
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
    traceId: 'trace-1',
  }) as ExecutionSnapshot;

describe('selectFrozenCall', () => {
  it('defaults to the last call_llm step', () => {
    const snap = snapshot([
      { contextEngine: { output: [{ content: 'first', role: 'user' }] } },
      { contextEngine: { output: [{ content: 'second', role: 'user' }] } },
    ]);

    expect(selectFrozenCall(snap)?.stepIndex).toBe(1);
    expect(selectFrozenCall(snap)?.messages).toEqual([{ content: 'second', role: 'user' }]);
  });

  it('carries the CE delta forward for steps that omit output', () => {
    const snap = snapshot([
      { contextEngine: { output: [{ content: 'frozen', role: 'user' }] } },
      { contextEngine: {} },
    ]);

    expect(selectFrozenCall(snap, 1)?.messages).toEqual([{ content: 'frozen', role: 'user' }]);
  });

  it('addresses steps by snapshot step index, not call_llm position', () => {
    const snap = snapshot([
      { contextEngine: { output: [{ content: 'a', role: 'user' }] } },
      { stepType: 'call_tool' },
      { contextEngine: { output: [{ content: 'b', role: 'user' }] } },
    ]);

    expect(selectFrozenCall(snap, 2)?.messages).toEqual([{ content: 'b', role: 'user' }]);
    expect(selectFrozenCall(snap, 1)).toBeUndefined();
    expect(listReplayableSteps(snap)).toEqual([0, 2]);
  });

  it('returns undefined when nothing was recorded', () => {
    expect(selectFrozenCall(snapshot([{ stepType: 'call_tool' }]))).toBeUndefined();
  });
});

describe('resolveStepTools', () => {
  it('walks back to the nearest step that recorded a toolset', () => {
    const tools = [{ function: { name: 'search' }, type: 'function' }];
    const snap = snapshot([
      { context: { payload: { tools }, phase: 'x' } },
      { contextEngine: {} },
      { contextEngine: {} },
    ]);

    expect(resolveStepTools(snap, 2)).toEqual(tools);
  });

  it('ignores toolsets recorded after the target step', () => {
    const snap = snapshot([
      { contextEngine: {} },
      { context: { payload: { tools: [{ type: 'function' }] }, phase: 'x' } },
    ]);

    expect(resolveStepTools(snap, 0)).toBeUndefined();
  });
});

describe('parseModelTargets', () => {
  it('parses a comma-separated provider/model list', () => {
    expect(parseModelTargets('openai/gpt-5, anthropic/claude-opus-5')).toEqual([
      { label: 'openai/gpt-5', model: 'gpt-5', provider: 'openai' },
      { label: 'anthropic/claude-opus-5', model: 'claude-opus-5', provider: 'anthropic' },
    ]);
  });

  it('keeps slashes inside the model id', () => {
    expect(parseModelTargets('openrouter/meta/llama-4')).toEqual([
      { label: 'openrouter/meta/llama-4', model: 'meta/llama-4', provider: 'openrouter' },
    ]);
  });

  it('falls back to the snapshot provider for a bare model name', () => {
    expect(parseModelTargets('gpt-5', 'lobehub')).toEqual([
      { label: 'lobehub/gpt-5', model: 'gpt-5', provider: 'lobehub' },
    ]);
  });

  it('rejects a bare model name with no fallback provider', () => {
    expect(() => parseModelTargets('gpt-5')).toThrow(/Cannot resolve a provider/);
  });

  it('rejects an empty list', () => {
    expect(() => parseModelTargets(' , ')).toThrow(/No model targets/);
  });
});

describe('buildReplayRequest', () => {
  const call = { messages: [{ content: 'hi', role: 'user' }], stepIndex: 0, tools: [{ a: 1 }] };
  const target = { label: 'openai/gpt-5', model: 'gpt-5', provider: 'openai' };

  it('carries the frozen messages and tools over verbatim, swapping only the model', () => {
    expect(buildReplayRequest({ call, target })).toEqual({
      messages: call.messages,
      model: 'gpt-5',
      responseMode: 'json',
      stream: false,
      tools: call.tools,
    });
  });

  it('drops tools when replaying without them', () => {
    expect(buildReplayRequest({ call, target, withTools: false })).not.toHaveProperty('tools');
  });

  it('omits sampling overrides that were not requested', () => {
    const request = buildReplayRequest({ call, target });
    expect(request).not.toHaveProperty('temperature');
    expect(request).not.toHaveProperty('max_tokens');
  });

  it('applies sampling overrides when given', () => {
    expect(buildReplayRequest({ call, maxTokens: 128, target, temperature: 0 })).toMatchObject({
      max_tokens: 128,
      temperature: 0,
    });
  });
});

describe('extractCompletionText', () => {
  it('reads the OpenAI shape', () => {
    expect(extractCompletionText({ choices: [{ message: { content: 'hello' } }] })).toBe('hello');
  });

  it('reads the Anthropic shape', () => {
    expect(extractCompletionText({ content: [{ text: 'a' }, { text: 'b' }] })).toBe('ab');
  });

  it('returns an empty string for a tool-only completion', () => {
    expect(extractCompletionText({ choices: [{ message: { content: null } }] })).toBe('');
  });
});

describe('extractToolCalls', () => {
  it('normalizes tool calls and drops unnamed entries', () => {
    const body = {
      choices: [
        {
          message: {
            tool_calls: [
              { function: { arguments: '{"q":1}', name: 'search' } },
              { function: { arguments: '{}' } },
            ],
          },
        },
      ],
    };

    expect(extractToolCalls(body)).toEqual([{ arguments: '{"q":1}', name: 'search' }]);
  });

  it('returns an empty list when there are none', () => {
    expect(extractToolCalls({ choices: [{ message: { content: 'x' } }] })).toEqual([]);
  });
});
