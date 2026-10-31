import type { ChannelContextMessage, ChannelInputManifest } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildChannelPrompt, CHANNEL_INSTRUCTIONS, CHANNEL_REPLY_GUIDELINES } from './channel';

describe('Channel request prompt', () => {
  it('includes the public-reply policy with the technical-detail exception', () => {
    expect(CHANNEL_INSTRUCTIONS).toContain(CHANNEL_REPLY_GUIDELINES);
    expect(CHANNEL_REPLY_GUIDELINES).toContain('display names');
    expect(CHANNEL_REPLY_GUIDELINES).toContain('never by internal sequence numbers as citations');
    expect(CHANNEL_REPLY_GUIDELINES).toContain('user explicitly asks');
    expect(CHANNEL_REPLY_GUIDELINES).toContain('earlier participants');
    expect(CHANNEL_REPLY_GUIDELINES).toContain(
      'not a dossier of past messages, directories or tasks',
    );
  });

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
      },
    ]);
    expect(JSON.parse(prompt).self).toEqual({ agentId: 'agent', name: 'Agent' });
    expect(JSON.parse(prompt)).not.toHaveProperty('conversation');
    expect(JSON.parse(prompt).currentRequestId).toBe('current');
  });

  it('includes only the explicit quote with attribution and bounded content', () => {
    const manifest: ChannelInputManifest = {
      cutoffSequence: 3,
      requestMessageId: 'current',
      requesterMemberId: 'member',
      self: { agentId: 'agent', memberId: 'agent-member', name: 'Agent' },
      threadId: 'thread',
      threadRootSequence: 2,
    };
    const author = { id: 'agent', name: 'Author', type: 'agent' as const };
    const messages: ChannelContextMessage[] = [
      { author, content: 'UNRELATED_HISTORY', id: 'old', sequence: 1, threadId: null },
      {
        author,
        content: 'q'.repeat(7000),
        fileIds: ['attachment'],
        id: 'quoted',
        sequence: 2,
        threadId: null,
      },
      {
        author: { id: 'user', name: 'Caller', type: 'user' },
        content: 'Why?',
        id: 'current',
        replyToId: 'quoted',
        sequence: 3,
        threadId: 'thread',
      },
    ];
    const prompt = buildChannelPrompt(manifest, messages);
    expect(prompt).not.toContain('UNRELATED_HISTORY');
    expect(JSON.parse(prompt).quotedMessage).toEqual({
      author,
      content: 'q'.repeat(6000),
      fileIds: ['attachment'],
      id: 'quoted',
      truncated: true,
    });
    expect(JSON.parse(prompt).messages).toHaveLength(1);
    expect(
      JSON.parse(buildChannelPrompt(manifest, messages.slice(2))).quotedMessage,
    ).toBeUndefined();
  });
});
