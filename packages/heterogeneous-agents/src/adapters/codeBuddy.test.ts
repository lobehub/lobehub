import { describe, expect, it } from 'vitest';

import { CodeBuddyAdapter } from './codeBuddy';

describe('CodeBuddyAdapter', () => {
  it('deduplicates init and ignores non-content system events', () => {
    const adapter = new CodeBuddyAdapter();
    const init = {
      model: 'default-model',
      session_id: 'cb-session-1',
      subtype: 'init',
      type: 'system',
    };

    const events = [
      ...adapter.adapt(init),
      ...adapter.adapt({ session_id: 'cb-session-1', subtype: 'status', type: 'system' }),
      ...adapter.adapt({ type: 'file-history-snapshot' }),
      ...adapter.adapt(init),
    ];

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      data: { model: 'default-model', provider: 'codebuddy', sessionId: 'cb-session-1' },
      type: 'stream_start',
    });
    expect(adapter.sessionId).toBe('cb-session-1');
  });

  it('keeps CodeBuddy identity on tool and usage events', () => {
    const adapter = new CodeBuddyAdapter();
    adapter.adapt({ session_id: 'cb-session-1', subtype: 'init', type: 'system' });

    const events = adapter.adapt({
      message: {
        content: [{ id: 'tool-1', input: { command: 'pwd' }, name: 'Bash', type: 'tool_use' }],
        id: 'message-1',
        model: 'gpt-5.4',
        usage: { input_tokens: 4, output_tokens: 2 },
      },
      type: 'assistant',
    });

    const tool = events.find((event) => event.type === 'stream_chunk');
    const usage = events.find((event) => event.type === 'step_complete');
    expect(tool?.data.toolsCalling[0]).toMatchObject({ identifier: 'codebuddy' });
    expect(usage?.data).toMatchObject({ model: 'gpt-5.4', provider: 'codebuddy' });
  });

  it('maps text, reasoning, tool results, and a successful terminal result', () => {
    const adapter = new CodeBuddyAdapter();
    adapter.adapt({ session_id: 'cb-session-1', subtype: 'init', type: 'system' });

    const assistantEvents = adapter.adapt({
      message: {
        content: [
          { thinking: 'checking', type: 'thinking' },
          { text: 'Running pwd', type: 'text' },
          { id: 'tool-1', input: { command: 'pwd' }, name: 'Bash', type: 'tool_use' },
        ],
        id: 'message-1',
        model: 'gpt-5.4',
      },
      type: 'assistant',
    });
    expect(assistantEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ reasoning: 'checking' }) }),
        expect.objectContaining({ data: expect.objectContaining({ content: 'Running pwd' }) }),
      ]),
    );

    const toolEvents = adapter.adapt({
      message: {
        content: [{ content: '/workspace', tool_use_id: 'tool-1', type: 'tool_result' }],
      },
      type: 'user',
    });
    expect(toolEvents.map((event) => event.type)).toEqual(['tool_result', 'tool_end']);
    expect(toolEvents[0].data).toMatchObject({ content: '/workspace', toolCallId: 'tool-1' });

    const resultEvents = adapter.adapt({ is_error: false, result: 'done', type: 'result' });
    expect(resultEvents.map((event) => event.type)).toEqual([
      'stream_end',
      'visible_output_end',
      'agent_runtime_end',
    ]);
  });

  it('keeps partial reasoning and text snapshots with different item ids in one turn', () => {
    const adapter = new CodeBuddyAdapter();
    const events = [
      ...adapter.adapt({
        model: 'hy3',
        session_id: 'cb-session-1',
        subtype: 'init',
        type: 'system',
      }),
      ...adapter.adapt({
        event: { message: { id: 'response-1', model: 'hy3' }, type: 'message_start' },
        type: 'stream_event',
      }),
      ...adapter.adapt({
        event: {
          delta: { thinking: 'checking', type: 'thinking_delta' },
          type: 'content_block_delta',
        },
        type: 'stream_event',
      }),
      ...adapter.adapt({
        event: {
          delta: { text: 'I am Hy3.', type: 'text_delta' },
          type: 'content_block_delta',
        },
        type: 'stream_event',
      }),
      ...adapter.adapt({
        event: { type: 'message_delta', usage: { input_tokens: 10, output_tokens: 4 } },
        type: 'stream_event',
      }),
      // CodeBuddy emits complete history items after the partial response. The
      // reasoning and text item ids are intentionally different from each
      // other and from response-1; they are not new model turns.
      ...adapter.adapt({
        message: {
          content: [{ thinking: 'checking', type: 'thinking' }],
          id: 'reasoning-item-1',
          model: 'hy3',
        },
        type: 'assistant',
      }),
      ...adapter.adapt({
        message: {
          content: [{ text: 'I am Hy3.', type: 'text' }],
          id: 'text-item-1',
          model: 'hy3',
        },
        type: 'assistant',
      }),
    ];

    expect(events.filter((event) => event.type === 'stream_start' && event.data.newStep)).toEqual(
      [],
    );
    expect(
      events
        .filter((event) => event.type === 'stream_chunk' && event.data.chunkType === 'reasoning')
        .map((event) => event.data.reasoning),
    ).toEqual(['checking']);
    expect(
      events
        .filter((event) => event.type === 'stream_chunk' && event.data.chunkType === 'text')
        .map((event) => event.data.content),
    ).toEqual(['I am Hy3.']);
    expect(
      events.filter(
        (event) => event.type === 'step_complete' && event.data.phase === 'turn_metadata',
      ),
    ).toHaveLength(1);
  });

  it('groups batch content item ids and opens one turn after a tool result', () => {
    const adapter = new CodeBuddyAdapter();
    adapter.adapt({ session_id: 'cb-session-1', subtype: 'init', type: 'system' });

    const firstTurn = [
      ...adapter.adapt({
        message: {
          content: [{ thinking: 'need the cwd', type: 'thinking' }],
          id: 'reasoning-item-1',
          model: 'hy3',
        },
        type: 'assistant',
      }),
      ...adapter.adapt({
        message: {
          content: [{ id: 'tool-1', input: { command: 'pwd' }, name: 'Bash', type: 'tool_use' }],
          id: 'tool-item-1',
          model: 'hy3',
        },
        type: 'assistant',
      }),
    ];
    adapter.adapt({
      message: { content: [{ content: '/workspace', tool_use_id: 'tool-1', type: 'tool_result' }] },
      type: 'user',
    });
    const secondTurn = [
      ...adapter.adapt({
        message: {
          content: [{ thinking: 'answering', type: 'thinking' }],
          id: 'reasoning-item-2',
          model: 'hy3',
        },
        type: 'assistant',
      }),
      ...adapter.adapt({
        message: {
          content: [{ text: 'Done.', type: 'text' }],
          id: 'text-item-2',
          model: 'hy3',
        },
        type: 'assistant',
      }),
    ];

    expect(firstTurn.some((event) => event.type === 'stream_start' && event.data.newStep)).toBe(
      false,
    );
    expect(
      secondTurn.filter((event) => event.type === 'stream_start' && event.data.newStep),
    ).toHaveLength(1);
    expect(
      secondTurn
        .filter((event) => event.type === 'stream_chunk' && event.data.chunkType === 'reasoning')
        .map((event) => event.data.reasoning),
    ).toEqual(['answering']);
    expect(
      secondTurn
        .filter((event) => event.type === 'stream_chunk' && event.data.chunkType === 'text')
        .map((event) => event.data.content),
    ).toEqual(['Done.']);
  });

  it('maps the real unauthenticated exit-zero result to one CodeBuddy auth error', () => {
    const adapter = new CodeBuddyAdapter();
    adapter.adapt({ session_id: 'cb-session-auth', subtype: 'init', type: 'system' });
    adapter.adapt({
      message: {
        content: [
          {
            text: 'Authentication required. Please use /login command to sign in to your account',
            type: 'text',
          },
        ],
        id: 'message-auth',
      },
      type: 'assistant',
    });

    const events = adapter.adapt({
      errors: ['Authentication required. Please use /login command to sign in to your account'],
      is_error: true,
      session_id: 'cb-session-auth',
      subtype: 'error_during_execution',
      type: 'result',
    });

    expect(events.map((event) => event.type)).toEqual([
      'stream_end',
      'visible_output_end',
      'error',
    ]);
    expect(events.at(-1)?.data).toMatchObject({
      agentType: 'codebuddy',
      clearEchoedContent: true,
      code: 'auth_required',
      docsUrl: 'https://www.codebuddy.ai/docs/cli/installation',
    });
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
  });
});
