import type { AssistantContentBlock } from '@lobechat/types';
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
    ],
  },
] as AssistantContentBlock[];

const wakeUp = (sourceToolCallId: string, type = 'task-completion') =>
  ({
    content: 'done',
    id: 'w1',
    metadata: { signal: { sourceToolCallId, sourceToolName: 'Agent', type } },
  }) as AssistantContentBlock;

describe('resolveTaskCompletionSource', () => {
  it('names the finished tool and its description from the reply’s own call', () => {
    expect(resolveTaskCompletionSource(wakeUp('call-srv'), replyBlocks)).toEqual({
      description: 'Server research',
      toolName: 'Agent',
    });
  });

  it('omits the description when the source call has none', () => {
    expect(resolveTaskCompletionSource(wakeUp('call-bash'), replyBlocks)).toEqual({
      description: undefined,
      toolName: 'Bash',
    });
  });

  it('falls back to the signal’s tool name when the call is not in the reply', () => {
    expect(resolveTaskCompletionSource(wakeUp('call-elsewhere'), replyBlocks)).toEqual({
      description: undefined,
      toolName: 'Agent',
    });
  });

  it('ignores blocks that are not task-completion turns', () => {
    expect(
      resolveTaskCompletionSource(wakeUp('call-srv', 'tool-stdout'), replyBlocks),
    ).toBeUndefined();
    expect(
      resolveTaskCompletionSource(
        { content: 'x', id: 'plain' } as AssistantContentBlock,
        replyBlocks,
      ),
    ).toBeUndefined();
  });
});
