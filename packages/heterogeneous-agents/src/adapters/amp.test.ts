import { describe, expect, it } from 'vitest';

import { AmpAdapter } from './amp';

const init = {
  agent_mode: 'medium',
  session_id: 'T-amp-123',
  subtype: 'init',
  type: 'system',
};

const assistant = (content: unknown[], usage?: Record<string, number>) => ({
  message: {
    content,
    role: 'assistant',
    ...(usage ? { usage } : {}),
  },
  type: 'assistant',
});

describe('AmpAdapter', () => {
  it('maps init, assistant text, and a successful result without borrowing another provider', () => {
    const adapter = new AmpAdapter();

    const start = adapter.adapt(init);
    const text = adapter.adapt(assistant([{ text: 'hello from Amp', type: 'text' }]));
    const end = adapter.adapt({
      duration_ms: 1200,
      is_error: false,
      num_turns: 1,
      result: 'hello from Amp',
      session_id: 'T-amp-123',
      subtype: 'success',
      type: 'result',
    });

    expect(adapter.sessionId).toBe('T-amp-123');
    expect(start).toHaveLength(1);
    expect(start[0]).toMatchObject({
      data: { provider: 'amp', sessionId: 'T-amp-123' },
      stepIndex: 0,
      type: 'stream_start',
    });
    expect(text).toEqual([
      expect.objectContaining({
        data: { chunkType: 'text', content: 'hello from Amp' },
        stepIndex: 0,
        type: 'stream_chunk',
      }),
    ]);
    expect(end.map((event) => event.type)).toEqual([
      'stream_end',
      'visible_output_end',
      'agent_runtime_end',
    ]);
  });

  it('keeps tool lifecycle and the post-tool assistant in separate steps', () => {
    const adapter = new AmpAdapter();
    adapter.adapt(init);

    const toolTurn = adapter.adapt(
      assistant([
        {
          id: 'toolu_amp_1',
          input: { cmd: 'pwd' },
          name: 'shell_command',
          type: 'tool_use',
        },
      ]),
    );
    const resultTurn = adapter.adapt({
      message: {
        content: [
          {
            content: '/workspace',
            is_error: false,
            tool_use_id: 'toolu_amp_1',
            type: 'tool_result',
          },
        ],
        role: 'user',
      },
      type: 'user',
    });
    const finalTurn = adapter.adapt(assistant([{ text: 'Done.', type: 'text' }]));

    expect(toolTurn.map((event) => event.type)).toEqual(['stream_chunk', 'tool_start']);
    expect(toolTurn[0]).toMatchObject({
      data: {
        chunkType: 'tools_calling',
        toolsCalling: [
          {
            apiName: 'shell_command',
            arguments: '{\n  "cmd": "pwd"\n}',
            id: 'toolu_amp_1',
            identifier: 'amp',
            type: 'default',
          },
        ],
      },
      stepIndex: 0,
    });
    expect(resultTurn.map((event) => event.type)).toEqual(['tool_result', 'tool_end']);
    expect(resultTurn[1]).toMatchObject({
      data: {
        isSuccess: true,
        payload: { toolCalling: { id: 'toolu_amp_1', identifier: 'amp' } },
        result: { content: '/workspace', success: true },
        toolCallId: 'toolu_amp_1',
      },
    });
    expect(finalTurn.map((event) => event.type)).toEqual([
      'stream_end',
      'stream_start',
      'stream_chunk',
    ]);
    expect(finalTurn[1]).toMatchObject({
      data: { newStep: true, provider: 'amp', sessionId: 'T-amp-123' },
      stepIndex: 1,
    });
    expect(finalTurn[2]).toMatchObject({
      data: { chunkType: 'text', content: 'Done.' },
      stepIndex: 1,
    });
  });

  it('normalizes AMP usage including cache reads and writes', () => {
    const adapter = new AmpAdapter();
    adapter.adapt(init);

    const events = adapter.adapt(
      assistant([{ thinking: 'checking', type: 'thinking' }], {
        cache_creation_input_tokens: 13,
        cache_read_input_tokens: 29,
        input_tokens: 101,
        output_tokens: 17,
      }),
    );

    expect(events[0]).toMatchObject({
      data: { chunkType: 'reasoning', reasoning: 'checking' },
      type: 'stream_chunk',
    });
    expect(events[1]).toMatchObject({
      data: {
        phase: 'turn_metadata',
        provider: 'amp',
        usage: {
          inputCachedTokens: 29,
          inputCacheMissTokens: 101,
          inputWriteCacheTokens: 13,
          outputTextTokens: 17,
          totalInputTokens: 143,
          totalOutputTokens: 17,
          totalTokens: 160,
        },
      },
      type: 'step_complete',
    });
  });

  it('treats an error result as terminal even when AMP may exit with code zero', () => {
    const adapter = new AmpAdapter();
    adapter.adapt(init);

    const events = adapter.adapt({
      duration_ms: 42,
      error: 'Invalid JSON input on stdin',
      is_error: true,
      num_turns: 0,
      session_id: 'T-amp-123',
      subtype: 'error_during_execution',
      type: 'result',
    });

    expect(events.map((event) => event.type)).toEqual([
      'stream_end',
      'visible_output_end',
      'error',
    ]);
    expect(events.at(-1)?.data).toMatchObject({
      agentType: 'amp',
      clearEchoedContent: true,
      details: {
        durationMs: 42,
        numTurns: 0,
        sessionId: 'T-amp-123',
        subtype: 'error_during_execution',
      },
      error: 'Invalid JSON input on stdin',
      message: 'Invalid JSON input on stdin',
    });
  });

  it('routes subagent events with synthetic turn ids and one-time spawn metadata', () => {
    const adapter = new AmpAdapter();
    adapter.adapt(init);
    adapter.adapt(
      assistant([
        {
          id: 'toolu_task_1',
          input: {
            description: 'Inspect tests',
            prompt: 'Find the failing test',
            subagent_type: 'explore',
          },
          name: 'Task',
          type: 'tool_use',
        },
      ]),
    );

    const first = adapter.adapt({
      ...assistant([{ text: 'Looking now.', type: 'text' }]),
      parent_tool_use_id: 'toolu_task_1',
    });
    const second = adapter.adapt({
      ...assistant([{ text: 'Found it.', type: 'text' }]),
      parent_tool_use_id: 'toolu_task_1',
    });

    expect(first[0]).toMatchObject({
      data: {
        content: 'Looking now.',
        subagent: {
          parentToolCallId: 'toolu_task_1',
          spawnMetadata: {
            description: 'Inspect tests',
            prompt: 'Find the failing test',
            subagentType: 'explore',
          },
          subagentMessageId: 'amp:toolu_task_1:1',
        },
      },
      stepIndex: 0,
      type: 'stream_chunk',
    });
    expect(second[0]).toMatchObject({
      data: {
        content: 'Found it.',
        subagent: {
          parentToolCallId: 'toolu_task_1',
          subagentMessageId: 'amp:toolu_task_1:2',
        },
      },
      stepIndex: 0,
    });
    expect(second[0].data.subagent.spawnMetadata).toBeUndefined();
  });

  it('flushes unfinished tools as unsuccessful without ending another provider runtime', () => {
    const adapter = new AmpAdapter();
    adapter.adapt(init);
    adapter.adapt(
      assistant([
        {
          id: 'toolu_pending',
          input: { cmd: 'long-task' },
          name: 'shell_command',
          type: 'tool_use',
        },
      ]),
    );

    const events = adapter.flush();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      data: {
        isSuccess: false,
        payload: { toolCalling: { id: 'toolu_pending', identifier: 'amp' } },
        toolCallId: 'toolu_pending',
      },
      type: 'tool_end',
    });
    expect(adapter.flush()).toEqual([]);
  });
});
