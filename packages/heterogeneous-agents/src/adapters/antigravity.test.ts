import { describe, expect, it } from 'vitest';

import { createAdapter } from '../registry';
import type { HeterogeneousAgentEvent } from '../types';
import { AntigravityAdapter } from './antigravity';

const init = { conversation_id: 'conv-1', event: 'init', init: { model: 'gemini-test' } };
const step = (index: number, fields: Record<string, unknown> = {}) => ({
  event: 'step_update',
  step_update: {
    conversation_id: 'conv-1',
    state: 'DONE',
    step_index: index,
    step_type: 'agent_response',
    ...fields,
  },
});
const result = (fields: Record<string, unknown> = {}) => ({
  event: 'result',
  result: { conversation_id: 'conv-1', response: 'hello\n', status: 'SUCCESS', ...fields },
});
const text = (events: HeterogeneousAgentEvent[]) =>
  events
    .filter((e) => e.type === 'stream_chunk' && e.data.chunkType === 'text')
    .map((e) => e.data.content)
    .join('');
const tool = (index: number, fields: Record<string, unknown> = {}) =>
  step(index, {
    step_type: 'tool',
    tool_info: {
      name: 'run_command',
      parameters: { CommandLine: 'echo hello' },
      output: 'hello\n',
    },
    ...fields,
  });

describe('AntigravityAdapter', () => {
  it('registers native agy and captures its conversation/model', () => {
    const adapter = createAdapter('antigravity');
    expect(adapter).toBeInstanceOf(AntigravityAdapter);
    expect(adapter.adapt(init)[0]).toMatchObject({
      data: { model: 'gemini-test', provider: 'antigravity', sessionId: 'conv-1' },
      type: 'stream_start',
    });
    expect(adapter.sessionId).toBe('conv-1');
  });

  it('concatenates ACTIVE and DONE deltas without echoing result.response', () => {
    const adapter = new AntigravityAdapter();
    const events = [
      init,
      step(2, { state: 'ACTIVE', text_delta: 'hel' }),
      step(2, { text_delta: 'lo\n' }),
      result(),
    ].flatMap((raw) => adapter.adapt(raw));
    expect(text(events)).toBe('hello\n');
    expect(events.filter((e) => e.type === 'stream_end')).toHaveLength(1);
    expect(adapter.flush()).toEqual([]);
    expect(adapter.validateCompletion()).toEqual([]);
  });

  it('keeps repeated text fragments and ignores a duplicate DONE step', () => {
    const adapter = new AntigravityAdapter();
    const events = [
      init,
      step(2, { state: 'ACTIVE', text_delta: 'ha' }),
      step(2, { text_delta: 'ha' }),
      step(2, { text_delta: 'ha' }),
    ].flatMap((raw) => adapter.adapt(raw));
    expect(text(events)).toBe('haha');
  });

  it('creates a completed-only tool before its result and starts the next assistant separately', () => {
    const adapter = new AntigravityAdapter();
    const events = [
      init,
      step(1, { text_delta: 'Checking.' }),
      tool(3),
      tool(4),
      step(6, { text_delta: 'hello\n' }),
      result(),
    ].flatMap((raw) => adapter.adapt(raw));
    const calls = events.filter(
      (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
    );
    expect(calls[1].data.toolsCalling).toHaveLength(2);
    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults.map((e) => e.data.toolCallId)).toEqual(['agy_conv-1_3', 'agy_conv-1_4']);
    expect(toolResults.every((e) => e.stepIndex === 0)).toBe(true);
    expect(events.indexOf(calls[0])).toBeLessThan(events.indexOf(toolResults[0]));
    expect(events.filter((e) => e.type === 'stream_start')[1]).toMatchObject({
      data: { newStep: true },
      stepIndex: 1,
    });
    expect(text(events)).toBe('Checking.hello\n');
  });

  it('updates a running tool with its final arguments and error exactly once', () => {
    const adapter = new AntigravityAdapter();
    adapter.adapt(init);
    adapter.adapt(tool(3, { state: 'ACTIVE', tool_info: { name: 'write_to_file' } }));
    const completed = tool(3, {
      tool_info: {
        name: 'write_to_file',
        parameters: { path: 'test.txt' },
        error: { type: 'DENIED', message: 'Permission denied' },
      },
    });
    const events = adapter.adapt(completed);
    expect(events[0].data.toolsCalling[0].arguments).toBe('{"path":"test.txt"}');
    expect(events.find((e) => e.type === 'tool_result')?.data).toMatchObject({
      content: 'Permission denied',
      isError: true,
      toolCallId: 'agy_conv-1_3',
    });
    expect(events.find((e) => e.type === 'tool_end')?.data.isSuccess).toBe(false);
    expect(adapter.adapt(completed)).toEqual([]);
  });

  it('settles unfinished tools on interruption and detects missing terminal results', () => {
    const adapter = new AntigravityAdapter();
    adapter.adapt(init);
    adapter.adapt(tool(3, { state: 'ACTIVE' }));
    expect(adapter.flush().find((e) => e.type === 'tool_result')?.data).toMatchObject({
      isError: true,
      toolCallId: 'agy_conv-1_3',
    });
    expect(adapter.validateCompletion()[0]).toMatchObject({
      type: 'error',
      data: { code: 'incomplete_response' },
    });
    expect(adapter.flush()).toEqual([]);
    expect(adapter.validateCompletion()).toEqual([]);
  });

  it('classifies missing login using the Antigravity sign-in guide', () => {
    const adapter = new AntigravityAdapter();
    expect(
      adapter.adapt(result({ status: 'ERROR', error: 'authentication required', response: '' })),
    ).toContainEqual(
      expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({
          agentType: 'antigravity',
          code: 'auth_required',
          command: 'agy',
        }),
      }),
    );
  });

  it.each(['ERROR', 'CANCELED', 'INTERRUPTED', 'INVALID', 'WAITING', 'RUNNING'])(
    'does not treat terminal %s as success',
    (status) => {
      const adapter = new AntigravityAdapter();
      expect(adapter.adapt(result({ status })).some((e) => e.type === 'error')).toBe(true);
      expect(adapter.validateCompletion()).toEqual([]);
    },
  );

  it('uses result-only text as a fallback, including after tool work', () => {
    const adapter = new AntigravityAdapter();
    const events = [init, step(1, { text_delta: 'Checking.' }), tool(3), result()].flatMap((raw) =>
      adapter.adapt(raw),
    );
    expect(text(events)).toBe('Checking.hello\n');
    expect(events.filter((e) => e.type === 'stream_start')[1].stepIndex).toBe(1);
  });

  it('keeps resumed cumulative usage separate from this turn', () => {
    const adapter = new AntigravityAdapter();
    const events = [
      init,
      step(20, {
        text_delta: 'hello\n',
        usage: {
          input_tokens: 278,
          cache_read_tokens: 30214,
          output_tokens: 4,
          thinking_tokens: 1,
        },
      }),
      result({ usage: { input_tokens: 30662, cache_read_tokens: 30214, output_tokens: 8 } }),
    ].flatMap((raw) => adapter.adapt(raw));
    const metadata = events.filter(
      (e) => e.type === 'step_complete' && e.data.phase === 'turn_metadata',
    );
    expect(metadata).toHaveLength(1);
    expect(metadata[0].data.usage).toMatchObject({
      inputCacheMissTokens: 278,
      totalInputTokens: 30492,
      totalOutputTokens: 4,
      outputReasoningTokens: 1,
    });
  });

  it('ignores malformed, unknown, and child-conversation events', () => {
    const adapter = new AntigravityAdapter();
    adapter.adapt(init);
    for (const raw of [
      null,
      [],
      {},
      { event: 'future' },
      step(-1),
      step(1, { conversation_id: 'child', text_delta: 'hidden' }),
    ]) {
      expect(adapter.adapt(raw)).toEqual([]);
    }
  });
});
