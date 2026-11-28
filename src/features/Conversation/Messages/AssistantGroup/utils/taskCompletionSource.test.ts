import type { AssistantContentBlock, MessageSignal } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveTaskCompletionSource } from './taskCompletionSource';

const replyBlocks = [
  {
    content: '',
    id: 'a1',
    tools: [
      {
        apiName: 'Agent',
        arguments: JSON.stringify({ description: ' Server research ', prompt: 'go' }),
        id: 'call-srv',
        identifier: 'claude-code',
        type: 'default',
      },
      {
        apiName: 'Bash',
        arguments: '{"command":"sleep 1","run_in_background":true}',
        id: 'call-bash',
        identifier: 'claude-code',
        type: 'default',
      },
      {
        apiName: 'SendMessage',
        arguments: '{"to":"a1b2c3","message":"Publish the report","summary":"Publish"}',
        id: 'call-send',
        identifier: 'claude-code',
        type: 'default',
      },
      {
        apiName: 'Monitor',
        arguments: '{"command":"tail -f build.log"}',
        id: 'call-monitor',
        identifier: 'claude-code',
        type: 'default',
      },
    ],
  },
] as AssistantContentBlock[];

const wakeUp = (
  sourceToolCallId: string,
  signal: Partial<MessageSignal> = {},
  type = 'task-completion',
) =>
  ({
    content: 'done',
    id: 'w1',
    metadata: { signal: { sourceToolCallId, sourceToolName: 'Agent', type, ...signal } },
  }) as AssistantContentBlock;

describe('resolveTaskCompletionSource', () => {
  it('names a subagent by the description of the call that launched it', () => {
    expect(
      resolveTaskCompletionSource(
        wakeUp('call-srv', { taskStatus: 'completed', taskSummary: 'Agent "Other" finished' }),
        replyBlocks,
      ),
    ).toEqual({
      kind: 'subagent',
      status: 'completed',
      summary: 'Agent "Other" finished',
      title: 'Server research',
      toolName: 'Agent',
    });
  });

  // Regression: the notice read "Send Message finished" because SendMessage
  // carries no description; the subagent's name survives only in the summary.
  it('names a SendMessage-resumed subagent from the task summary', () => {
    expect(
      resolveTaskCompletionSource(
        wakeUp('call-send', {
          taskStatus: 'completed',
          taskSummary: 'Agent "Acceptance runner" finished',
        }),
        replyBlocks,
      ),
    ).toMatchObject({ kind: 'subagent', title: 'Acceptance runner', toolName: 'SendMessage' });
  });

  it('reads a background command title and failure from the task summary', () => {
    expect(
      resolveTaskCompletionSource(
        wakeUp('call-bash', {
          taskStatus: 'failed',
          taskSummary: 'Background command "Run "unit" tests" failed with exit code 1',
        }),
        replyBlocks,
      ),
    ).toMatchObject({ kind: 'command', status: 'failed', title: 'Run "unit" tests' });
  });

  it('leaves a legacy SendMessage wake-up without a title or status', () => {
    expect(resolveTaskCompletionSource(wakeUp('call-send'), replyBlocks)).toEqual({
      kind: 'subagent',
      status: undefined,
      summary: undefined,
      title: undefined,
      toolName: 'SendMessage',
    });
  });

  it('keeps other long-running tools labelled by their tool', () => {
    expect(resolveTaskCompletionSource(wakeUp('call-monitor'), replyBlocks)).toMatchObject({
      kind: 'tool',
      toolName: 'Monitor',
    });
  });

  it('falls back to the signal’s tool name when the call is not in the reply', () => {
    expect(resolveTaskCompletionSource(wakeUp('call-elsewhere'), replyBlocks)).toMatchObject({
      kind: 'subagent',
      title: undefined,
      toolName: 'Agent',
    });
  });

  it('ignores blocks that are not task-completion turns', () => {
    expect(
      resolveTaskCompletionSource(wakeUp('call-srv', {}, 'tool-stdout'), replyBlocks),
    ).toBeUndefined();
    expect(
      resolveTaskCompletionSource(
        { content: 'x', id: 'plain' } as AssistantContentBlock,
        replyBlocks,
      ),
    ).toBeUndefined();
  });
});
