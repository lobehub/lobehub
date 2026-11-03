import { describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from './claudeCode';

const init = {
  model: 'claude-sonnet-4-6',
  session_id: 'sess_1',
  subtype: 'init',
  type: 'system',
};
const messageStart = (id: string) => ({
  event: { message: { id, model: 'claude-sonnet-4-6' }, type: 'message_start' },
  type: 'stream_event',
});
const newStepOf = (events: any[]) =>
  events.find((event) => event.type === 'stream_start' && event.data?.newStep);

describe('ClaudeCodeAdapter live input', () => {
  it('opens the turn after a delivered user message as a user turn while a background task runs', () => {
    const adapter = new ClaudeCodeAdapter({
      runtimeEndStrategy: 'on-transport-close',
      signalBackgroundTaskCompletion: true,
    });
    adapter.adapt(init);
    adapter.adapt({
      message: {
        content: [
          {
            id: 'toolu_agent',
            input: { run_in_background: true },
            name: 'Agent',
            type: 'tool_use',
          },
        ],
        id: 'msg_01',
      },
      type: 'assistant',
    });
    adapter.adapt({
      session_id: 'sess_1',
      subtype: 'task_started',
      task_id: 'task_1',
      tool_use_id: 'toolu_agent',
      type: 'system',
    });
    adapter.adapt({
      message: {
        content: [{ content: 'launched', tool_use_id: 'toolu_agent', type: 'tool_result' }],
      },
      type: 'user',
    });
    adapter.adapt(messageStart('msg_02'));
    adapter.adapt({ is_error: false, result: 'launched', subtype: 'success', type: 'result' });

    // The host delivers a message; Claude Code replays it and answers it.
    expect(
      adapter.adapt({
        isReplay: true,
        message: { content: [{ text: 'also open the PRs', type: 'text' }], role: 'user' },
        type: 'user',
        uuid: 'u-2',
      }),
    ).toEqual([]);
    const reply = newStepOf(adapter.adapt(messageStart('msg_03')));

    expect(reply).toBeDefined();
    expect(reply.data.externalSignal).toBeUndefined();
  });

  it('keeps the reply to a delivered message out of a task completion that lands after the replay', () => {
    const adapter = new ClaudeCodeAdapter({
      runtimeEndStrategy: 'on-transport-close',
      signalBackgroundTaskCompletion: true,
    });
    adapter.adapt(init);
    adapter.adapt({
      message: {
        content: [
          {
            id: 'toolu_bash',
            input: { command: 'sleep 1', run_in_background: true },
            name: 'Bash',
            type: 'tool_use',
          },
        ],
        id: 'msg_01',
      },
      type: 'assistant',
    });
    adapter.adapt({
      session_id: 'sess_1',
      subtype: 'task_started',
      task_id: 'task_1',
      tool_use_id: 'toolu_bash',
      type: 'system',
    });
    adapter.adapt({
      message: {
        content: [{ content: 'started', tool_use_id: 'toolu_bash', type: 'tool_result' }],
      },
      type: 'user',
    });
    adapter.adapt(messageStart('msg_02'));
    adapter.adapt({ is_error: false, result: 'started', subtype: 'success', type: 'result' });

    // Replay → task notification → the user's turn (anthropics/claude-code#39632).
    adapter.adapt({
      isReplay: true,
      message: { content: [{ text: 'what next?', type: 'text' }], role: 'user' },
      type: 'user',
      uuid: 'u-2',
    });
    adapter.adapt({
      session_id: 'sess_1',
      subtype: 'task_notification',
      task_id: 'task_1',
      type: 'system',
    });
    const reply = newStepOf(adapter.adapt(messageStart('msg_03')));

    expect(reply.data.externalSignal).toBeUndefined();
  });

  it('still tags a turn the background task opens without user input', () => {
    const adapter = new ClaudeCodeAdapter({
      runtimeEndStrategy: 'on-transport-close',
      signalBackgroundTaskCompletion: true,
    });
    adapter.adapt(init);
    adapter.adapt({
      message: {
        content: [{ id: 'toolu_mon', input: {}, name: 'Monitor', type: 'tool_use' }],
        id: 'msg_01',
      },
      type: 'assistant',
    });
    adapter.adapt({
      session_id: 'sess_1',
      subtype: 'task_started',
      task_id: 'task_1',
      tool_use_id: 'toolu_mon',
      type: 'system',
    });
    adapter.adapt({
      message: { content: [{ content: 'started', tool_use_id: 'toolu_mon', type: 'tool_result' }] },
      type: 'user',
    });
    adapter.adapt(messageStart('msg_02'));

    const callback = newStepOf(adapter.adapt(messageStart('msg_03')));

    expect(callback.data.externalSignal).toMatchObject({ sourceToolCallId: 'toolu_mon' });
  });
});
