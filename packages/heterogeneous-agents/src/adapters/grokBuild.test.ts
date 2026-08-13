import { describe, expect, it } from 'vitest';

import { GrokBuildAdapter } from './grokBuild';

const update = (
  value: Record<string, unknown>,
  meta: Record<string, unknown> = {},
  method = 'session/update',
): Record<string, unknown> => ({
  jsonrpc: '2.0',
  method,
  params: {
    _meta: meta,
    sessionId: 'grok-session',
    update: value,
  },
});

describe('GrokBuildAdapter', () => {
  it('maps ACP chunks and preserves native tool call ids', () => {
    const adapter = new GrokBuildAdapter();
    const events = [
      ...adapter.adapt(
        update({
          content: { text: 'thinking', type: 'text' },
          sessionUpdate: 'agent_thought_chunk',
        }),
      ),
      ...adapter.adapt(
        update({
          kind: 'read',
          rawInput: { path: 'src/a.ts' },
          sessionUpdate: 'tool_call',
          status: 'in_progress',
          title: 'Read',
          toolCallId: 'native-call-1',
        }),
      ),
      ...adapter.adapt(
        update({
          content: [{ text: 'file body', type: 'text' }],
          sessionUpdate: 'tool_call_update',
          status: 'in_progress',
          toolCallId: 'native-call-1',
        }),
      ),
      ...adapter.adapt(
        update({
          sessionUpdate: 'tool_call_update',
          status: 'completed',
          toolCallId: 'native-call-1',
        }),
      ),
      ...adapter.adapt(
        update({
          content: { text: 'done', type: 'text' },
          sessionUpdate: 'agent_message_chunk',
        }),
      ),
    ];

    expect(events.map(({ type }) => type)).toEqual([
      'stream_start',
      'stream_chunk',
      'stream_chunk',
      'tool_start',
      'tool_result',
      'tool_end',
      'stream_chunk',
    ]);
    expect(events.find(({ type }) => type === 'tool_start')?.data).toMatchObject({
      toolCalling: { id: 'native-call-1', identifier: 'grok-build' },
      toolCallId: 'native-call-1',
    });
    expect(events.find(({ type }) => type === 'tool_result')?.data).toEqual({
      content: 'file body',
      isError: false,
      toolCallId: 'native-call-1',
    });
  });

  it('deduplicates event ids and ignores replay, unknown, and malformed updates', () => {
    const adapter = new GrokBuildAdapter();
    const message = update(
      {
        content: { text: 'once', type: 'text' },
        sessionUpdate: 'agent_message_chunk',
      },
      { eventId: 'event-1' },
    );

    expect(adapter.adapt(message)).toHaveLength(2);
    expect(adapter.adapt(message)).toEqual([]);
    expect(
      adapter.adapt(
        update(
          {
            content: { text: 'old', type: 'text' },
            sessionUpdate: 'agent_message_chunk',
          },
          { isReplay: true },
        ),
      ),
    ).toEqual([]);
    expect(adapter.adapt(update({ sessionUpdate: 'future_update' }))).toEqual([]);
    expect(adapter.adapt(null)).toEqual([]);
  });

  it('emits usage boundaries and terminal lifecycle events', () => {
    const adapter = new GrokBuildAdapter();
    expect(
      adapter.adapt({
        jsonrpc: '2.0',
        method: 'x.ai/session/prompt_complete',
        params: {
          promptId: 'prompt-1',
          sessionId: 'grok-session',
          stopReason: 'end_turn',
        },
      }),
    ).toEqual([]);
    const boundary = adapter.adapt(
      update(
        {
          promptId: 'prompt-1',
          sessionUpdate: 'turn_completed',
          stop_reason: 'end_turn',
          usage: {
            cache_read_input_tokens: 2,
            input_tokens: 10,
            output_tokens: 5,
            reasoning_tokens: 2,
          },
        },
        {},
        'x.ai/session_notification',
      ),
    );
    const completed = adapter.adapt({
      id: 5,
      jsonrpc: '2.0',
      result: {
        _meta: {
          modelId: 'grok-build',
          usage: { cachedReadTokens: 3, inputTokens: 12, outputTokens: 4 },
        },
        stopReason: 'end_turn',
      },
    });

    expect(boundary.at(-1)).toMatchObject({
      data: {
        phase: 'turn_metadata',
        usage: { outputReasoningTokens: 2, totalTokens: 15 },
      },
      type: 'step_complete',
    });
    expect(
      adapter.adapt(
        update({
          promptId: 'prompt-1',
          sessionUpdate: 'turn_completed',
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      ),
    ).toEqual([]);
    expect(completed.map(({ type }) => type)).toEqual([
      'step_complete',
      'stream_end',
      'visible_output_end',
      'agent_runtime_end',
    ]);
    expect(completed.at(-1)?.data).toEqual({ reason: 'complete', transport: 'acp-stdio' });
  });

  it('maps ACP auth errors to the structured auth-required guide', () => {
    const adapter = new GrokBuildAdapter();
    const events = adapter.adapt({
      error: {
        code: -32_000,
        data: 'No cached auth token found. Run `grok login` to authenticate.',
        message: 'Authentication required',
      },
      id: 2,
      jsonrpc: '2.0',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      data: {
        agentType: 'grok-build',
        code: 'auth_required',
        command: 'grok',
      },
      type: 'error',
    });
  });
});
