import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { CodexAdapter } from './codex';

const loadFixture = async (name: string) => {
  const raw = await readFile(new URL(`./__fixtures__/codex/${name}`, import.meta.url), 'utf8');
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
};

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

  it('maps todo_list items into shared todo plugin state', () => {
    const adapter = new CodexAdapter();

    const todoItem = {
      id: 'item_0',
      items: [
        { completed: true, text: 'Create the three-item todo list' },
        { completed: false, text: 'Keep the second item incomplete' },
        { completed: false, text: 'Keep the third item incomplete' },
      ],
      type: 'todo_list',
    };

    const started = adapter.adapt({
      item: todoItem,
      type: 'item.started',
    });
    const completed = adapter.adapt({
      item: todoItem,
      type: 'item.completed',
    });

    expect(started[0]).toMatchObject({
      data: {
        chunkType: 'tools_calling',
        toolsCalling: [
          {
            apiName: 'todo_list',
            id: 'item_0',
            identifier: 'codex',
          },
        ],
      },
      type: 'stream_chunk',
    });
    expect(completed[0]).toMatchObject({
      data: {
        content: 'Todo list updated (1/3 completed).',
        pluginState: {
          todos: {
            items: [
              { status: 'completed', text: 'Create the three-item todo list' },
              { status: 'processing', text: 'Keep the second item incomplete' },
              { status: 'todo', text: 'Keep the third item incomplete' },
            ],
          },
        },
        toolCallId: 'item_0',
      },
      type: 'tool_result',
    });
    expect(completed[1]).toMatchObject({
      data: { isSuccess: true, toolCallId: 'item_0' },
      type: 'tool_end',
    });
  });

  it('maps file_change items into readable tool results', () => {
    const adapter = new CodexAdapter();

    const started = adapter.adapt({
      item: {
        changes: [{ kind: 'add', path: '/private/tmp/codex-file-change-sample.txt' }],
        id: 'item_1',
        status: 'in_progress',
        type: 'file_change',
      },
      type: 'item.started',
    });
    const completed = adapter.adapt({
      item: {
        changes: [
          {
            kind: 'add',
            linesAdded: 3,
            linesDeleted: 0,
            path: '/private/tmp/codex-file-change-sample.txt',
          },
        ],
        id: 'item_1',
        linesAdded: 3,
        linesDeleted: 0,
        status: 'completed',
        type: 'file_change',
      },
      type: 'item.completed',
    });

    expect(started[0]).toMatchObject({
      data: {
        chunkType: 'tools_calling',
        toolsCalling: [
          {
            apiName: 'file_change',
            id: 'item_1',
            identifier: 'codex',
          },
        ],
      },
      type: 'stream_chunk',
    });
    expect(completed[0]).toMatchObject({
      data: {
        content: 'File changes applied (1 added, +3 -0).',
        isError: false,
        pluginState: {
          changes: [
            {
              kind: 'add',
              linesAdded: 3,
              linesDeleted: 0,
              path: '/private/tmp/codex-file-change-sample.txt',
            },
          ],
          linesAdded: 3,
          linesDeleted: 0,
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

  it('uses failure copy for unsuccessful non-command tool completions', () => {
    const adapter = new CodexAdapter();

    adapter.adapt({
      item: {
        id: 'todo_failed',
        items: [{ completed: false, text: 'Keep this pending' }],
        status: 'failed',
        type: 'todo_list',
      },
      type: 'item.started',
    });
    const failedTodo = adapter.adapt({
      item: {
        id: 'todo_failed',
        items: [{ completed: false, text: 'Keep this pending' }],
        status: 'failed',
        type: 'todo_list',
      },
      type: 'item.completed',
    });

    expect(failedTodo[0]).toMatchObject({
      data: {
        content: 'Todo list update failed.',
        isError: true,
        toolCallId: 'todo_failed',
      },
      type: 'tool_result',
    });
    expect(failedTodo[0].data).not.toHaveProperty('pluginState');
    expect(failedTodo[1]).toMatchObject({
      data: { isSuccess: false, toolCallId: 'todo_failed' },
      type: 'tool_end',
    });

    adapter.adapt({
      item: {
        changes: [{ kind: 'add', path: '/private/tmp/cancelled-change.ts' }],
        id: 'file_cancelled',
        status: 'cancelled',
        type: 'file_change',
      },
      type: 'item.started',
    });
    const cancelledFileChange = adapter.adapt({
      item: {
        changes: [{ kind: 'add', path: '/private/tmp/cancelled-change.ts' }],
        id: 'file_cancelled',
        status: 'cancelled',
        type: 'file_change',
      },
      type: 'item.completed',
    });

    expect(cancelledFileChange[0]).toMatchObject({
      data: {
        content: 'File changes cancelled.',
        isError: true,
        toolCallId: 'file_cancelled',
      },
      type: 'tool_result',
    });
    expect(cancelledFileChange[0].data).not.toHaveProperty('pluginState');
    expect(cancelledFileChange[1]).toMatchObject({
      data: { isSuccess: false, toolCallId: 'file_cancelled' },
      type: 'tool_end',
    });

    adapter.adapt({
      item: {
        id: 'wait_failed',
        status: 'error',
        tool: 'wait',
        type: 'collab_tool_call',
      },
      type: 'item.started',
    });
    const failedWait = adapter.adapt({
      item: {
        id: 'wait_failed',
        status: 'error',
        tool: 'wait',
        type: 'collab_tool_call',
      },
      type: 'item.completed',
    });

    expect(failedWait[0]).toMatchObject({
      data: {
        content: 'wait failed.',
        isError: true,
        toolCallId: 'wait_failed',
      },
      type: 'tool_result',
    });
    expect(failedWait[1]).toMatchObject({
      data: { isSuccess: false, toolCallId: 'wait_failed' },
      type: 'tool_end',
    });
  });

  it('keeps a real collab_tool_call stream fixture readable and flushes unfinished attempts', async () => {
    const adapter = new CodexAdapter();
    const rawEvents = await loadFixture('collab_tool_call.spawn_wait.jsonl');

    const adapted = rawEvents.flatMap((event) => adapter.adapt(event));
    const flushed = adapter.flush();

    const toolStarts = adapted
      .filter((event) => event.type === 'tool_start')
      .map((event) => event.data.toolCallId);
    const toolResults = adapted
      .filter((event) => event.type === 'tool_result')
      .map((event) => event.data);

    expect(toolStarts).toEqual(['item_1', 'item_3', 'item_4']);
    expect(toolResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Spawned 1 subagent.',
          toolCallId: 'item_3',
        }),
        expect.objectContaining({
          content: 'Wait completed: 2 + 2 = 4',
          toolCallId: 'item_4',
        }),
      ]),
    );
    expect(flushed).toEqual([
      expect.objectContaining({
        data: {
          isSuccess: false,
          toolCallId: 'item_1',
        },
        type: 'tool_end',
      }),
    ]);
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
