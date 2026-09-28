import type { AssistantContentBlock, UIChatMessage, UISignalCallbacksBlock } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildContinuationChains, collectSignalCallbacks } from './continuations';

const block = (id: string): AssistantContentBlock => ({ content: id, id });

const signalBlock = (id: string): UISignalCallbacksBlock => ({
  callbacks: [{ content: id, id }],
  sourceToolCallId: `${id}-tool`,
  sourceToolMessageId: id,
  sourceToolName: 'monitor',
});

const message = (input: Partial<UIChatMessage> & { id: string; role: UIChatMessage['role'] }) =>
  ({
    content: '',
    createdAt: 1,
    updatedAt: 1,
    ...input,
  }) as UIChatMessage;

describe('assistant group continuations', () => {
  it('keeps task completion summaries in continuation chains', () => {
    const chains = buildContinuationChains(
      [{ groupId: 'group-2', steerUserId: 'steer-1' }],
      [
        message({
          children: [block('child-1')],
          id: 'group-2',
          role: 'assistantGroup',
          taskCompletions: [block('task-summary-1')],
        }),
      ],
    );

    expect(chains).toEqual([
      {
        blocks: [
          expect.objectContaining({ id: 'child-1' }),
          expect.objectContaining({ id: 'task-summary-1' }),
        ],
        id: 'group-2',
        steerUserId: 'steer-1',
      },
    ]);
  });

  it('collects signal callbacks from the host and every continuation', () => {
    expect(
      collectSignalCallbacks(
        [signalBlock('host-signal')],
        [
          message({
            id: 'group-2',
            role: 'assistantGroup',
            signalCallbacks: [signalBlock('continuation-signal')],
          }),
        ],
      ).map((signal) => signal.sourceToolMessageId),
    ).toEqual(['host-signal', 'continuation-signal']);
  });
});
