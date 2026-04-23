import { describe, expect, it } from 'vitest';

import { CodexAdapter } from './codex';

describe('CodexAdapter', () => {
  it('captures the session id from thread.started', () => {
    const adapter = new CodexAdapter();

    const events = adapter.adapt({
      thread_id: 'thread-123',
      type: 'thread.started',
    });

    expect(events).toHaveLength(0);
    expect(adapter.sessionId).toBe('thread-123');
  });

  it('emits stream start and text chunks for turn + agent messages', () => {
    const adapter = new CodexAdapter();

    const start = adapter.adapt({ type: 'turn.started' });
    const text = adapter.adapt({
      item: {
        id: 'item_0',
        text: 'hello from codex',
        type: 'agent_message',
      },
      type: 'item.completed',
    });

    expect(start[0]).toMatchObject({
      data: { provider: 'codex' },
      type: 'stream_start',
    });
    expect(text[0]).toMatchObject({
      data: { chunkType: 'text', content: 'hello from codex' },
      type: 'stream_chunk',
    });
  });

  it('emits a new-step boundary when a second turn starts', () => {
    const adapter = new CodexAdapter();

    const firstTurn = adapter.adapt({ type: 'turn.started' });
    const secondTurn = adapter.adapt({ type: 'turn.started' });

    expect(firstTurn).toHaveLength(1);
    expect(firstTurn[0]).toMatchObject({
      data: { provider: 'codex' },
      stepIndex: 0,
      type: 'stream_start',
    });

    expect(secondTurn).toHaveLength(2);
    expect(secondTurn[0]).toMatchObject({
      data: {},
      stepIndex: 1,
      type: 'stream_end',
    });
    expect(secondTurn[1]).toMatchObject({
      data: { newStep: true, provider: 'codex' },
      stepIndex: 1,
      type: 'stream_start',
    });
  });

  it('emits a new-step boundary when a later agent_message item arrives in the same turn', () => {
    const adapter = new CodexAdapter();

    adapter.adapt({ type: 'turn.started' });
    adapter.adapt({
      item: {
        id: 'item_0',
        text: 'Running the first checks.',
        type: 'agent_message',
      },
      type: 'item.completed',
    });
    adapter.adapt({
      item: {
        command: '/bin/zsh -lc pwd',
        id: 'item_1',
        status: 'in_progress',
        type: 'command_execution',
      },
      type: 'item.started',
    });
    adapter.adapt({
      item: {
        aggregated_output: '/repo\\n',
        command: '/bin/zsh -lc pwd',
        exit_code: 0,
        id: 'item_1',
        status: 'completed',
        type: 'command_execution',
      },
      type: 'item.completed',
    });

    const secondMessage = adapter.adapt({
      item: {
        id: 'item_2',
        text: 'Now I will inspect the branch.',
        type: 'agent_message',
      },
      type: 'item.completed',
    });

    expect(secondMessage).toHaveLength(3);
    expect(secondMessage[0]).toMatchObject({
      data: {},
      stepIndex: 1,
      type: 'stream_end',
    });
    expect(secondMessage[1]).toMatchObject({
      data: { newStep: true, provider: 'codex' },
      stepIndex: 1,
      type: 'stream_start',
    });
    expect(secondMessage[2]).toMatchObject({
      data: { chunkType: 'text', content: 'Now I will inspect the branch.' },
      stepIndex: 1,
      type: 'stream_chunk',
    });
  });

  it('maps command execution items into tool lifecycle events', () => {
    const adapter = new CodexAdapter();

    const started = adapter.adapt({
      item: {
        command: '/bin/zsh -lc pwd',
        id: 'item_1',
        status: 'in_progress',
        type: 'command_execution',
      },
      type: 'item.started',
    });
    const completed = adapter.adapt({
      item: {
        aggregated_output: '/tmp\\n',
        command: '/bin/zsh -lc pwd',
        exit_code: 0,
        id: 'item_1',
        status: 'completed',
        type: 'command_execution',
      },
      type: 'item.completed',
    });

    expect(started).toHaveLength(2);
    expect(started[0]).toMatchObject({
      data: {
        chunkType: 'tools_calling',
        toolsCalling: [
          {
            apiName: 'command_execution',
            id: 'item_1',
            identifier: 'codex',
          },
        ],
      },
      type: 'stream_chunk',
    });
    expect(started[1]).toMatchObject({
      data: { toolCallId: 'item_1' },
      type: 'tool_start',
    });

    expect(completed).toHaveLength(2);
    expect(completed[0]).toMatchObject({
      data: {
        content: '/tmp\\n',
        pluginState: {
          exitCode: 0,
          isBackground: false,
          output: '/tmp\\n',
          stdout: '/tmp\\n',
          success: true,
        },
        toolCallId: 'item_1',
      },
      type: 'tool_result',
    });
    expect(completed[1]).toMatchObject({
      data: { isSuccess: true, toolCallId: 'item_1' },
      type: 'tool_end',
    });
  });

  it('emits cumulative tools_calling within the same Codex step', () => {
    const adapter = new CodexAdapter();

    adapter.adapt({ type: 'turn.started' });

    const firstTool = adapter.adapt({
      item: {
        command: '/bin/zsh -lc pwd',
        id: 'item_1',
        status: 'in_progress',
        type: 'command_execution',
      },
      type: 'item.started',
    });
    const secondTool = adapter.adapt({
      item: {
        command: "/bin/zsh -lc 'git status --short'",
        id: 'item_2',
        status: 'in_progress',
        type: 'command_execution',
      },
      type: 'item.started',
    });

    expect(firstTool[0]).toMatchObject({
      data: {
        chunkType: 'tools_calling',
        toolsCalling: [{ id: 'item_1' }],
      },
      type: 'stream_chunk',
    });
    expect(secondTool[0]).toMatchObject({
      data: {
        chunkType: 'tools_calling',
        toolsCalling: [{ id: 'item_1' }, { id: 'item_2' }],
      },
      type: 'stream_chunk',
    });
    expect(secondTool[1]).toMatchObject({
      data: { toolCallId: 'item_2' },
      type: 'tool_start',
    });
  });

  it('resets cumulative tools_calling after a same-turn agent_message step boundary', () => {
    const adapter = new CodexAdapter();

    adapter.adapt({ type: 'turn.started' });
    adapter.adapt({
      item: {
        id: 'item_0',
        text: 'Running the first checks.',
        type: 'agent_message',
      },
      type: 'item.completed',
    });
    adapter.adapt({
      item: {
        command: '/bin/zsh -lc pwd',
        id: 'item_1',
        status: 'in_progress',
        type: 'command_execution',
      },
      type: 'item.started',
    });
    adapter.adapt({
      item: {
        id: 'item_2',
        text: 'Now I will inspect the branch.',
        type: 'agent_message',
      },
      type: 'item.completed',
    });

    const nextStepTool = adapter.adapt({
      item: {
        command: "/bin/zsh -lc 'git branch --show-current'",
        id: 'item_3',
        status: 'in_progress',
        type: 'command_execution',
      },
      type: 'item.started',
    });

    expect(nextStepTool[0]).toMatchObject({
      data: {
        chunkType: 'tools_calling',
        toolsCalling: [{ id: 'item_3' }],
      },
      stepIndex: 1,
      type: 'stream_chunk',
    });
  });

  it('maps turn.completed usage into turn metadata', () => {
    const adapter = new CodexAdapter();

    const events = adapter.adapt({
      type: 'turn.completed',
      usage: {
        cached_input_tokens: 4,
        input_tokens: 10,
        output_tokens: 3,
      },
    });

    expect(events[0]).toMatchObject({
      data: {
        phase: 'turn_metadata',
        provider: 'codex',
        usage: {
          inputCachedTokens: 4,
          inputCacheMissTokens: 10,
          totalInputTokens: 14,
          totalOutputTokens: 3,
          totalTokens: 17,
        },
      },
      type: 'step_complete',
    });
  });

  it('hydrates turn metadata model from session_configured when turn.completed omits it', () => {
    const adapter = new CodexAdapter();

    adapter.adapt({
      model: 'gpt-5.3-codex',
      type: 'session_configured',
    });

    const events = adapter.adapt({
      type: 'turn.completed',
      usage: {
        input_tokens: 10,
        output_tokens: 3,
      },
    });

    expect(events[0]).toMatchObject({
      data: {
        model: 'gpt-5.3-codex',
        phase: 'turn_metadata',
        provider: 'codex',
      },
      type: 'step_complete',
    });
  });

  it('emits turn metadata when turn.completed reports a model without usage', () => {
    const adapter = new CodexAdapter();

    const events = adapter.adapt({
      model: 'gpt-5.4',
      type: 'turn.completed',
    });

    expect(events[0]).toMatchObject({
      data: {
        model: 'gpt-5.4',
        phase: 'turn_metadata',
        provider: 'codex',
      },
      type: 'step_complete',
    });
  });
});
