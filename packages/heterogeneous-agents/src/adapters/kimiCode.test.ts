import { describe, expect, it } from 'vitest';

import { KimiCodeAdapter } from './kimiCode';

describe('KimiCodeAdapter', () => {
  it('maps the documented text, parallel tools, results, and resume hint sequence', () => {
    const adapter = new KimiCodeAdapter();
    const first = adapter.adapt({
      content: 'Checking.',
      role: 'assistant',
      tool_calls: [
        {
          function: { arguments: '{"path":"a"}', name: 'read_file' },
          id: 'call-1',
          type: 'function',
        },
        { function: { arguments: '{}', name: 'list_files' }, id: 'call-2', type: 'function' },
      ],
    });
    expect(first.map((event) => event.type)).toEqual([
      'stream_start',
      'stream_chunk',
      'stream_chunk',
    ]);
    expect(first[2].data.toolsCalling).toHaveLength(2);

    const firstResult = adapter.adapt({
      content: 'contents',
      role: 'tool',
      tool_call_id: 'call-1',
    });
    expect(firstResult.map((event) => event.type)).toEqual(['tool_result', 'tool_end']);
    expect(firstResult.every((event) => event.stepIndex === 0)).toBe(true);
    expect(firstResult[1].data).toMatchObject({
      payload: {
        toolCalling: {
          apiName: 'read_file',
          identifier: 'kimi-code',
        },
      },
      result: { content: 'contents', success: true },
    });
    expect(adapter.adapt({ content: 'duplicate', role: 'tool', tool_call_id: 'call-1' })).toEqual(
      [],
    );
    expect(adapter.adapt({ content: 'orphan', role: 'tool', tool_call_id: 'missing' })).toEqual([]);
    expect(
      adapter
        .adapt({ content: ['a', 'b'], role: 'tool', tool_call_id: 'call-2' })
        .map((event) => event.type),
    ).toEqual(['tool_result', 'tool_end']);

    const second = adapter.adapt({ content: 'Done.', role: 'assistant' });
    expect(second.map((event) => event.type)).toEqual([
      'stream_end',
      'stream_start',
      'stream_chunk',
    ]);
    expect(second[1]).toMatchObject({ data: { newStep: true }, stepIndex: 1 });

    expect(
      adapter.adapt({ role: 'meta', session_id: 'session-1', type: 'session.resume_hint' }),
    ).toEqual([]);
    expect(adapter.sessionId).toBe('session-1');
    expect(adapter.flush().map((event) => event.type)).toEqual(['stream_end']);
    expect(adapter.flush()).toEqual([]);
  });

  it('keeps assistant records in one step until a tool result creates an inferable boundary', () => {
    const adapter = new KimiCodeAdapter();
    expect(
      adapter.adapt({ content: 'Hook output.', role: 'assistant' }).map((e) => e.type),
    ).toEqual(['stream_start', 'stream_chunk']);
    expect(
      adapter.adapt({ content: 'Main output.', role: 'assistant' }).map((e) => e.type),
    ).toEqual(['stream_chunk']);

    const firstTool = adapter.adapt({
      role: 'assistant',
      tool_calls: [{ function: { arguments: '{}', name: 'Read' }, id: 'call-1', type: 'function' }],
    });
    expect(firstTool[0].data.toolsCalling).toHaveLength(1);
    const secondTool = adapter.adapt({
      role: 'assistant',
      tool_calls: [
        { function: { arguments: '{}', name: 'Shell' }, id: 'call-2', type: 'function' },
      ],
    });
    expect(secondTool[0].data.toolsCalling.map((call: any) => call.id)).toEqual([
      'call-1',
      'call-2',
    ]);
  });

  it('maps retry metadata and settles tools left pending at EOF exactly once', () => {
    const adapter = new KimiCodeAdapter();
    adapter.adapt({
      role: 'assistant',
      tool_calls: [
        { function: { arguments: '{}', name: 'list_files' }, id: 'call-1', type: 'function' },
      ],
    });

    const retry = adapter.adapt({
      delay_ms: 500,
      error_message: 'busy',
      error_name: 'HTTPError',
      failed_attempt: 1,
      max_attempts: 3,
      next_attempt: 2,
      role: 'meta',
      status_code: 503,
      type: 'turn.step.retrying',
    });
    expect(retry[0]).toMatchObject({
      data: { attempt: 2, delayMs: 500, maxAttempts: 3, provider: 'kimi-code', statusCode: 503 },
      type: 'stream_retry',
    });

    const flushed = adapter.flush();
    expect(flushed.map((event) => event.type)).toEqual(['tool_result', 'tool_end', 'stream_end']);
    expect(flushed[0].data).toMatchObject({ isError: true, toolCallId: 'call-1' });
    expect(flushed[1].data).toMatchObject({
      payload: { toolCalling: { identifier: 'kimi-code' } },
      result: { success: false },
    });
    expect(adapter.flush()).toEqual([]);
  });

  it('ignores malformed input', () => {
    const adapter = new KimiCodeAdapter();
    expect(adapter.adapt(null)).toEqual([]);
    expect(adapter.adapt('bad')).toEqual([]);
    expect(adapter.adapt({ role: 'assistant', tool_calls: [{ id: 3 }] })).toEqual([]);
    expect(adapter.adapt({ role: 'meta', type: 'system.version', version: '0.28.0' })).toEqual([]);
    expect(adapter.adapt({ status: 'complete', type: 'goal.summary' })).toEqual([]);
  });
});
