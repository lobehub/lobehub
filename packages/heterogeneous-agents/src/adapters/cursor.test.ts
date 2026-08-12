import { describe, expect, it } from 'vitest';

import { CursorAdapter } from './cursor';

const assistant = (text: string, fields: Record<string, unknown> = {}) => ({
  ...fields,
  message: { content: [{ text, type: 'text' }], role: 'assistant' },
  session_id: 'cursor-session',
  type: 'assistant',
});

describe('CursorAdapter', () => {
  it('captures init metadata and streams buffered text', () => {
    const adapter = new CursorAdapter();
    expect(
      adapter.adapt({
        model: 'sonnet',
        session_id: 'cursor-session',
        subtype: 'init',
        type: 'system',
      }),
    ).toEqual([
      expect.objectContaining({
        data: { model: 'sonnet', provider: 'cursor', sessionId: 'cursor-session' },
        type: 'stream_start',
      }),
    ]);
    expect(adapter.adapt(assistant('answer'))[0]).toMatchObject({
      data: { chunkType: 'text', content: 'answer' },
      type: 'stream_chunk',
    });
  });

  it('deduplicates partial, cumulative buffered, and result text', () => {
    const adapter = new CursorAdapter();
    const events = [
      ...adapter.adapt(assistant('Hel', { timestamp_ms: 1 })),
      ...adapter.adapt(assistant('lo', { timestamp_ms: 2 })),
      ...adapter.adapt(assistant('Hello', { model_call_id: 'model', timestamp_ms: 3 })),
      ...adapter.adapt(assistant('Hello')),
      ...adapter.adapt({ is_error: false, result: 'Hello', subtype: 'success', type: 'result' }),
    ];
    expect(
      events.filter((event) => event.type === 'stream_chunk').map((event) => event.data.content),
    ).toEqual(['Hel', 'lo']);
    expect(events.map((event) => event.type)).toEqual([
      'stream_start',
      'stream_chunk',
      'stream_chunk',
      'stream_end',
      'visible_output_end',
      'agent_runtime_end',
    ]);
  });

  it('emits a missing buffered suffix', () => {
    const adapter = new CursorAdapter();
    const events = [
      ...adapter.adapt(assistant('Part', { timestamp_ms: 1 })),
      ...adapter.adapt(assistant('Partial answer', { model_call_id: 'model', timestamp_ms: 2 })),
    ];
    expect(
      events.filter((event) => event.type === 'stream_chunk').map((event) => event.data.content),
    ).toEqual(['Part', 'ial answer']);
  });

  it('maps started and completed tools once', () => {
    const adapter = new CursorAdapter();
    const started = {
      call_id: 'tool-1',
      subtype: 'started',
      tool_call: { readToolCall: { args: { path: 'README.md' } } },
      type: 'tool_call',
    };
    const completed = {
      ...started,
      subtype: 'completed',
      tool_call: {
        readToolCall: {
          args: { path: 'README.md' },
          result: { success: { content: '# Project' } },
        },
      },
    };
    const events = [...adapter.adapt(started), ...adapter.adapt(completed)];
    expect(events.map((event) => event.type)).toEqual([
      'stream_start',
      'stream_chunk',
      'tool_start',
      'tool_result',
      'tool_end',
    ]);
    expect(events[1].data.toolsCalling[0]).toMatchObject({
      apiName: 'readToolCall',
      arguments: '{"path":"README.md"}',
      id: 'tool-1',
    });
    expect(events[3].data).toEqual({ content: '# Project', isError: false, toolCallId: 'tool-1' });
    expect(adapter.adapt(completed)).toEqual([]);
  });

  it('maps generic function tools and rejected results', () => {
    const adapter = new CursorAdapter();
    const events = adapter.adapt({
      call_id: 'tool-function',
      subtype: 'completed',
      tool_call: {
        function: {
          arguments: '{"query":"term"}',
          name: 'search',
          result: { rejected: { message: 'denied' } },
        },
      },
      type: 'tool_call',
    });

    expect(events[1].data.toolsCalling[0]).toMatchObject({
      apiName: 'search',
      arguments: '{"query":"term"}',
      identifier: 'cursor',
    });
    expect(events[3].data).toEqual({
      content: 'denied',
      isError: true,
      toolCallId: 'tool-function',
    });
    expect(events[4].data).toEqual({ isSuccess: false, toolCallId: 'tool-function' });
  });

  it('classifies authentication errors', () => {
    const adapter = new CursorAdapter();
    const events = adapter.adapt({
      is_error: true,
      result: 'Authentication required',
      subtype: 'error',
      type: 'result',
    });
    expect(events.at(-1)).toMatchObject({
      data: {
        agentType: 'cursor',
        code: 'auth_required',
        message: 'Cursor could not authenticate. Run `agent login`, then retry.',
      },
      type: 'error',
    });
    expect(adapter.flush()).toEqual([]);
  });

  it('does not classify an unrelated required-field failure as authentication', () => {
    const adapter = new CursorAdapter();
    const events = adapter.adapt({
      is_error: true,
      result: 'Workspace path is required',
      subtype: 'error',
      type: 'result',
    });

    expect(events.at(-1)).toMatchObject({
      data: {
        agentType: 'cursor',
        message: 'Workspace path is required',
      },
      type: 'error',
    });
    expect(events.at(-1)?.data).not.toHaveProperty('code');
  });

  it('flushes pending tools as errors', () => {
    const adapter = new CursorAdapter();
    adapter.adapt({
      call_id: 'pending',
      subtype: 'started',
      tool_call: { shellToolCall: { args: {} } },
      type: 'tool_call',
    });
    const events = adapter.flush();
    expect(events.map((event) => event.type)).toEqual([
      'tool_result',
      'tool_end',
      'stream_end',
      'visible_output_end',
    ]);
    expect(events[0].data).toMatchObject({ isError: true, toolCallId: 'pending' });
    expect(events[1].data).toEqual({ isSuccess: false, toolCallId: 'pending' });
    expect(adapter.flush()).toEqual([]);
  });

  it('ignores malformed, unknown, and post-terminal events', () => {
    const adapter = new CursorAdapter();
    expect(adapter.adapt(null)).toEqual([]);
    expect(adapter.adapt('bad')).toEqual([]);
    expect(adapter.adapt({ type: 'future_event' })).toEqual([]);
    expect(adapter.adapt({ message: {}, type: 'assistant' })).toEqual([]);

    adapter.adapt({ is_error: false, result: 'done', subtype: 'success', type: 'result' });
    expect(adapter.adapt(assistant('ignored after terminal'))).toEqual([]);
  });
});
