import type { ChannelHistoryMessage, ChannelHistoryPage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { ChannelExecutionRuntime } from './index';

const message: ChannelHistoryMessage = {
  author: { id: 'agent-other', name: 'Coder', type: 'agent' },
  content: 'The working directory is /workspace/demo. Issue #42 is fixed.',
  contentLength: 63,
  fileIds: ['file-example'],
  id: 'message-example',
  sequence: 42,
  threadId: 'thread-example',
  truncated: false,
};

describe('Channel model-facing history', () => {
  it('omits sequencing metadata from model content, preserving UI state and pagination', async () => {
    const page: ChannelHistoryPage = {
      cutoffSequence: 50,
      messages: [message],
      nextBeforeSequence: 42,
    };
    const runtime = new ChannelExecutionRuntime({
      readMessage: vi.fn(),
      readMessages: vi.fn().mockResolvedValue(page),
    });
    const result = await runtime.readMessages({ limit: 1 });
    expect(result.success).toBe(true);
    expect(result.state).toBe(page);
    expect(JSON.parse(result.content!)).toEqual({
      messages: [
        {
          author: message.author,
          content: message.content,
          contentLength: message.contentLength,
          fileIds: message.fileIds,
          id: message.id,
          truncated: false,
        },
      ],
      nextBeforeSequence: 42,
    });
    expect(page.messages[0].sequence).toBe(42);
  });

  it('preserves full-message references, attachments and continuation without internal numbering', async () => {
    const detail = {
      attachments: [
        {
          fileType: 'text/plain',
          id: 'file-example',
          name: 'notes.txt',
          size: 10,
          url: 'https://example.com/notes.txt',
        },
      ],
      message,
      nextOffset: 12000,
      offset: 0,
    };
    const runtime = new ChannelExecutionRuntime({
      readMessage: vi.fn().mockResolvedValue(detail),
      readMessages: vi.fn(),
    });
    const result = await runtime.readMessage({ messageId: message.id });
    const content = JSON.parse(result.content!);
    expect(content.message).not.toHaveProperty('sequence');
    expect(content.message).not.toHaveProperty('threadId');
    expect(content.message.author).toEqual(message.author);
    expect(content.message.content).toBe(message.content);
    expect(content.message.id).toBe(message.id);
    expect(content.attachments).toEqual(detail.attachments);
    expect(content.nextOffset).toBe(12000);
    expect(result.state).toBe(detail);
  });

  it('still reports a failed history read', async () => {
    const runtime = new ChannelExecutionRuntime({
      readMessage: vi.fn(),
      readMessages: vi.fn().mockRejectedValue(new Error('Conversation is no longer active')),
    });
    expect(await runtime.readMessages({})).toMatchObject({
      success: false,
      content: 'Conversation is no longer active',
      error: { type: 'ChannelHistoryError' },
    });
  });
});

describe('Channel messaging', () => {
  const history = { readMessage: vi.fn(), readMessages: vi.fn() };

  it('returns the directory and the posted message as content and state', async () => {
    const directory = {
      channels: [
        {
          agents: [{ agentId: 'agent-lobehub', description: null, name: 'LobeHub Agent' }],
          current: false,
          id: 'channel-lobehub',
          kind: 'group' as const,
          projectId: null,
          title: 'General',
        },
      ],
      hasMore: false,
    };
    const sent = {
      agents: [{ agentId: 'agent-lobehub', name: 'LobeHub Agent' }],
      channelId: 'channel-lobehub',
      channelTitle: 'General',
      messageId: 'message-sent',
      url: 'https://example.com/channels/channel-lobehub',
    };
    const messaging = {
      listChannels: vi.fn().mockResolvedValue(directory),
      sendMessage: vi.fn().mockResolvedValue(sent),
    };
    const runtime = new ChannelExecutionRuntime(history, messaging);

    const listed = await runtime.listChannels({ agentId: 'agent-lobehub' });
    expect(messaging.listChannels).toHaveBeenCalledWith({ agentId: 'agent-lobehub' });
    expect(listed).toMatchObject({ state: directory, success: true });
    expect(JSON.parse(listed.content!)).toEqual(directory);

    const params = { agentIds: ['agent-lobehub'], channelId: 'channel-lobehub', content: 'Hi' };
    const result = await runtime.sendMessage(params);
    expect(messaging.sendMessage).toHaveBeenCalledWith(params);
    expect(result).toMatchObject({ state: sent, success: true });
  });

  it('reports a refused send, and a run without messaging', async () => {
    const runtime = new ChannelExecutionRuntime(history, {
      listChannels: vi.fn(),
      sendMessage: vi.fn().mockRejectedValue(new Error('Not an Agent member of "General"')),
    });
    expect(
      await runtime.sendMessage({ agentIds: ['x'], channelId: 'c', content: 'Hi' }),
    ).toMatchObject({
      content: 'Not an Agent member of "General"',
      error: { type: 'ChannelMessagingError' },
      success: false,
    });
    expect(await new ChannelExecutionRuntime(history).listChannels()).toMatchObject({
      error: { type: 'ChannelMessagingError' },
      success: false,
    });
  });
});
