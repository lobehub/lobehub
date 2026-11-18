import { describe, expect, it } from 'vitest';

import { CodexAdapter } from './codex';

const configWarningItem = {
  id: 'item_0',
  message: '`[features].multi_agent` is deprecated. It still controls the V1 fallback.',
  type: 'error',
};

describe('CodexAdapter error items', () => {
  it('does not map a non-fatal error item into a tool call', () => {
    const adapter = new CodexAdapter();
    adapter.adapt({ thread_id: 'thread-1', type: 'thread.started' });
    adapter.adapt({ type: 'turn.started' });

    const events = [
      ...adapter.adapt({ item: configWarningItem, type: 'item.started' }),
      ...adapter.adapt({ item: configWarningItem, type: 'item.completed' }),
    ];

    expect(events).toEqual([]);
  });

  it('keeps the run going and leaves real tool calls intact after an error item', () => {
    const adapter = new CodexAdapter();
    adapter.adapt({ type: 'turn.started' });
    adapter.adapt({ item: configWarningItem, type: 'item.completed' });

    const command = {
      aggregated_output: '/tmp\n',
      command: '/bin/zsh -lc pwd',
      exit_code: 0,
      id: 'item_1',
      status: 'completed',
      type: 'command_execution',
    };
    const toolEvents = adapter.adapt({ item: command, type: 'item.completed' });
    const toolsCalling = toolEvents.find(
      (event) => event.type === 'stream_chunk' && event.data.chunkType === 'tools_calling',
    );

    expect(toolsCalling?.data.toolsCalling.map((tool: { id: string }) => tool.id)).toEqual([
      'item_1',
    ]);
    expect(toolEvents.find((event) => event.type === 'tool_end')?.data).toMatchObject({
      isSuccess: true,
      toolCallId: 'item_1',
    });

    const endEvents = adapter.adapt({ type: 'turn.completed', usage: {} });
    expect(endEvents.some((event) => event.type === 'error')).toBe(false);
    expect(endEvents.filter((event) => event.type === 'tool_end')).toEqual([]);
    expect(endEvents.at(-1)?.type).toBe('agent_runtime_end');
  });

  it('does not open a new step for an error item between agent messages', () => {
    const adapter = new CodexAdapter();
    adapter.adapt({ type: 'turn.started' });
    adapter.adapt({
      item: { id: 'item_0', text: 'First', type: 'agent_message' },
      type: 'item.completed',
    });
    adapter.adapt({ item: { ...configWarningItem, id: 'item_1' }, type: 'item.completed' });

    const next = adapter.adapt({
      item: { id: 'item_2', text: 'Second', type: 'agent_message' },
      type: 'item.completed',
    });

    expect(next.map((event) => event.type)).toEqual(['stream_chunk']);
  });

  it('still fails the run on a top-level Codex error event', () => {
    const adapter = new CodexAdapter();
    adapter.adapt({ type: 'turn.started' });

    const events = adapter.adapt({ message: 'Selected model is unavailable.', type: 'error' });

    expect(events.at(-1)).toMatchObject({
      data: { message: 'Selected model is unavailable.' },
      type: 'error',
    });
  });
});
