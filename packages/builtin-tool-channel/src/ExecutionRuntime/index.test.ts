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
