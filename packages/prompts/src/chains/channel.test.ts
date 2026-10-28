import type { ChannelContextMessage, ChannelInputManifest } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildChannelPrompt } from './channel';

describe('Channel request prompt', () => {
  it('carries only the current request with attribution, never injected public history', () => {
    const manifest: ChannelInputManifest = {
      cutoffSequence: 2,
      requestMessageId: 'current',
      requesterMemberId: 'member',
      self: { agentId: 'agent', memberId: 'agent-member', name: 'Agent' },
      threadId: null,
      threadRootSequence: null,
    };
    const messages: ChannelContextMessage[] = [
      {
        author: { id: 'someone', name: 'Another person', type: 'user' },
        content: 'HISTORICAL_SECRET',
        id: 'old',
        sequence: 1,
        threadId: null,
      },
      {
        author: { id: 'caller', name: 'Caller', type: 'user' },
        content: 'Summarize the discussion',
        id: 'current',
        sequence: 2,
        fileIds: ['file'],
        threadId: null,
      },
    ];
    const prompt = buildChannelPrompt(manifest, messages);
    expect(prompt).not.toContain('HISTORICAL_SECRET');
    expect(JSON.parse(prompt).messages).toEqual([
      {
        author: messages[1].author,
        content: messages[1].content,
        fileIds: ['file'],
        id: 'current',
        sequence: 2,
      },
    ]);
  });
});
