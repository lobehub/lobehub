import { describe, expect, it } from 'vitest';

import { QoderAdapter } from './qoder';

describe('QoderAdapter', () => {
  it('maps lifecycle, text, and usage with Qoder identity', () => {
    const adapter = new QoderAdapter();
    const start = adapter.adapt({
      model: 'qoder-default',
      session_id: 'qoder-session-1',
      subtype: 'init',
      type: 'system',
    });

    expect(start[0]).toMatchObject({
      data: { model: 'qoder-default', provider: 'qoder', sessionId: 'qoder-session-1' },
      type: 'stream_start',
    });
    expect(adapter.sessionId).toBe('qoder-session-1');

    const assistant = adapter.adapt({
      message: {
        content: [{ text: 'hello', type: 'text' }],
        id: 'msg-1',
        model: 'qoder-default',
        usage: { input_tokens: 12, output_tokens: 3 },
      },
      type: 'assistant',
    });
    expect(assistant).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({ chunkType: 'text', content: 'hello' }),
        type: 'stream_chunk',
      }),
    );
    expect(assistant).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({ provider: 'qoder' }),
        type: 'step_complete',
      }),
    );

    expect(
      adapter.adapt({ is_error: false, result: 'done', type: 'result' }).map((event) => event.type),
    ).toEqual(['stream_end', 'visible_output_end', 'agent_runtime_end']);
  });

  it('maps partial text and thinking deltas', () => {
    const adapter = new QoderAdapter();
    adapter.adapt({ subtype: 'init', type: 'system' });
    adapter.adapt({
      event: { message: { id: 'msg-1', model: 'qoder-default' }, type: 'message_start' },
      type: 'stream_event',
    });

    const text = adapter.adapt({
      event: {
        delta: { text: 'Hel', type: 'text_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      type: 'stream_event',
    });
    const thinking = adapter.adapt({
      event: {
        delta: { thinking: 'reasoning', type: 'thinking_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      type: 'stream_event',
    });

    expect(text[0]).toMatchObject({ data: { chunkType: 'text', content: 'Hel' } });
    expect(thinking[0]).toMatchObject({
      data: { chunkType: 'reasoning', reasoning: 'reasoning' },
    });
  });

  it('normalizes tool calls, results, and parent lineage to Qoder', () => {
    const adapter = new QoderAdapter();
    adapter.adapt({ subtype: 'init', type: 'system' });

    const toolEvents = adapter.adapt({
      message: {
        content: [{ id: 'tool-1', input: { command: 'pwd' }, name: 'Bash', type: 'tool_use' }],
        id: 'msg-sub',
      },
      parent_tool_use_id: 'parent-tool-1',
      type: 'assistant',
    });
    const calling = toolEvents.find(
      (event) => event.type === 'stream_chunk' && event.data.chunkType === 'tools_calling',
    );
    expect(calling?.data).toMatchObject({
      subagent: { parentToolCallId: 'parent-tool-1' },
      toolsCalling: [{ apiName: 'Bash', id: 'tool-1', identifier: 'qoder' }],
    });
    expect(toolEvents.find((event) => event.type === 'tool_start')?.data).toMatchObject({
      subagent: { parentToolCallId: 'parent-tool-1' },
      toolCalling: { identifier: 'qoder' },
    });

    const resultEvents = adapter.adapt({
      message: {
        content: [{ content: '/workspace', tool_use_id: 'tool-1', type: 'tool_result' }],
        role: 'user',
      },
      parent_tool_use_id: 'parent-tool-1',
      type: 'user',
    });
    expect(resultEvents.find((event) => event.type === 'tool_result')?.data).toMatchObject({
      content: '/workspace',
      subagent: { parentToolCallId: 'parent-tool-1' },
      toolCallId: 'tool-1',
    });
    expect(resultEvents.find((event) => event.type === 'tool_end')?.data).toMatchObject({
      payload: { toolCalling: { identifier: 'qoder' } },
      subagent: { parentToolCallId: 'parent-tool-1' },
    });
  });

  it('preserves synthesized todo state from Qoder Task tools', () => {
    const adapter = new QoderAdapter();
    adapter.adapt({ subtype: 'init', type: 'system' });
    adapter.adapt({
      message: {
        content: [
          {
            id: 'task-create-1',
            input: {
              activeForm: 'Adding Qoder todo support',
              description: 'Keep the synthesized task state for the UI.',
              subject: 'Add Qoder todo support',
            },
            name: 'TaskCreate',
            type: 'tool_use',
          },
        ],
        id: 'msg-task-create',
      },
      type: 'assistant',
    });

    const events = adapter.adapt({
      message: {
        content: [
          {
            content: 'Task #1 created successfully: Add Qoder todo support',
            tool_use_id: 'task-create-1',
            type: 'tool_result',
          },
        ],
        role: 'user',
      },
      type: 'user',
    });
    const pluginState = {
      todos: {
        items: [{ id: '1', status: 'todo', text: 'Add Qoder todo support' }],
        updatedAt: expect.any(String),
      },
    };
    expect(events.find((event) => event.type === 'tool_result')?.data.pluginState).toEqual(
      pluginState,
    );
    expect(events.find((event) => event.type === 'tool_end')?.data.result.state).toEqual(
      pluginState,
    );

    adapter.adapt({
      message: {
        content: [
          {
            id: 'task-update-1',
            input: { status: 'completed', taskId: '1' },
            name: 'TaskUpdate',
            type: 'tool_use',
          },
        ],
        id: 'msg-task-update',
      },
      type: 'assistant',
    });
    const updatedEvents = adapter.adapt({
      message: {
        content: [
          {
            content: 'Updated task #1 status',
            tool_use_id: 'task-update-1',
            type: 'tool_result',
          },
        ],
        role: 'user',
      },
      type: 'user',
    });
    const updatedPluginState = {
      todos: {
        items: [{ id: '1', status: 'completed', text: 'Add Qoder todo support' }],
        updatedAt: expect.any(String),
      },
    };
    expect(updatedEvents.find((event) => event.type === 'tool_result')?.data.pluginState).toEqual(
      updatedPluginState,
    );
    expect(updatedEvents.find((event) => event.type === 'tool_end')?.data.result.state).toEqual(
      updatedPluginState,
    );
  });

  it('preserves Qoder WebSearch structured sources on tool_result and tool_end', () => {
    const adapter = new QoderAdapter();
    adapter.adapt({ subtype: 'init', type: 'system' });
    adapter.adapt({
      message: {
        content: [
          {
            id: 'web-search-1',
            input: { query: 'TradingView copper futures symbol ticker' },
            name: 'WebSearch',
            type: 'tool_use',
          },
        ],
        id: 'msg-search',
      },
      type: 'assistant',
    });

    const events = adapter.adapt({
      message: {
        content: [
          {
            content: 'Web search results for query: "TradingView copper futures symbol ticker"',
            tool_use_id: 'web-search-1',
            type: 'tool_result',
          },
        ],
        role: 'user',
      },
      tool_use_result: {
        durationSeconds: 2.938580792,
        query: 'TradingView copper futures symbol ticker',
        results: [
          {
            hostname: 'www.tradingview.com',
            link: 'https://www.tradingview.com/symbols/COMEX-HG1!/',
            snippet: 'The current price of Copper Futures is 6.7190 USD',
            title: 'HG1! Charts and Quotes - Futures',
          },
        ],
      },
      type: 'user',
    });

    const result = events.find((event) => event.type === 'tool_result');
    const end = events.find((event) => event.type === 'tool_end');
    expect(result?.data.pluginState).toEqual({
      durationSeconds: 2.938580792,
      query: 'TradingView copper futures symbol ticker',
      results: [
        {
          hostname: 'www.tradingview.com',
          link: 'https://www.tradingview.com/symbols/COMEX-HG1!/',
          snippet: 'The current price of Copper Futures is 6.7190 USD',
          title: 'HG1! Charts and Quotes - Futures',
        },
      ],
    });
    expect(end?.data).toMatchObject({
      payload: { toolCalling: { identifier: 'qoder' } },
      result: { state: result?.data.pluginState, success: true },
    });
  });

  it('emits one structured Qoder auth error even though Qoder exits successfully', () => {
    const adapter = new QoderAdapter();
    adapter.adapt({ subtype: 'init', type: 'system' });
    const authText = 'Not logged in · Please run /login';

    expect(
      adapter.adapt({
        message: {
          content: [
            { text: 'Not logged in', type: 'text' },
            { text: 'Please run /login', type: 'text' },
          ],
          id: 'msg-auth',
        },
        type: 'assistant',
      }),
    ).toEqual([]);

    const events = adapter.adapt({
      is_error: true,
      result: authText,
      subtype: 'success',
      type: 'result',
    });
    expect(events.map((event) => event.type)).toEqual([
      'stream_end',
      'visible_output_end',
      'error',
    ]);
    expect(events[2].data).toMatchObject({
      agentType: 'qoder',
      code: 'auth_required',
      docsUrl: 'https://docs.qoder.com/cli/auth.md',
      stderr: authText,
    });
    expect(events[2].data.message).toContain('Qoder');
  });

  it('normalizes pending tool identity when flushing', () => {
    const adapter = new QoderAdapter();
    adapter.adapt({ subtype: 'init', type: 'system' });
    adapter.adapt({
      message: {
        content: [{ id: 'tool-1', input: {}, name: 'Read', type: 'tool_use' }],
        id: 'msg-1',
      },
      type: 'assistant',
    });

    expect(adapter.flush()[0]).toMatchObject({
      data: { payload: { toolCalling: { identifier: 'qoder' } }, toolCallId: 'tool-1' },
      type: 'tool_end',
    });
  });
});
