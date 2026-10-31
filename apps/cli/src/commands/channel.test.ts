import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerChannelCommand } from './channel';

const historyMessage = {
  author: { id: 'agent-example', name: 'Coder', type: 'agent' },
  content: 'Working in /workspace/demo, issue #42.',
  contentLength: 37,
  fileIds: ['file-example'],
  id: 'message-example',
  sequence: 12,
  threadId: null,
  truncated: false,
};

const { readMessages, readMessage, output } = vi.hoisted(() => ({
  readMessages: vi.fn(),
  readMessage: vi.fn(),
  output: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    channel: { readMessages: { query: readMessages }, readMessage: { query: readMessage } },
  }),
}));
vi.mock('../utils/format', () => ({ outputJson: output }));

describe('Channel CLI', () => {
  beforeEach(() => vi.clearAllMocks());
  const run = (args: string[]) => {
    const program = new Command();
    registerChannelCommand(program);
    return program.parseAsync(args, { from: 'user' });
  };
  it('prints the cursor and messages without supplying an arbitrary channel or user identity', async () => {
    const page = { cutoffSequence: 20, messages: [historyMessage], nextBeforeSequence: 12 };
    readMessages.mockResolvedValue(page);
    await run(['channel', 'history', '--before', '20', '--limit', '5', '--json']);
    expect(readMessages).toHaveBeenCalledWith({ beforeSequence: 20, limit: 5 });
    expect(output).toHaveBeenCalledWith({
      messages: [
        {
          author: historyMessage.author,
          content: historyMessage.content,
          contentLength: historyMessage.contentLength,
          fileIds: historyMessage.fileIds,
          id: historyMessage.id,
          truncated: false,
        },
      ],
      nextBeforeSequence: 12,
    });
  });
  it('continues a long message', async () => {
    readMessage.mockResolvedValue({ message: historyMessage, nextOffset: null, offset: 12000 });
    await run(['channel', 'message', 'message-id', '--offset', '12000', '--json']);
    expect(readMessage).toHaveBeenCalledWith({ messageId: 'message-id', offset: 12000 });
    const result = output.mock.calls[0][0];
    expect(result.message).not.toHaveProperty('sequence');
    expect(result.message).not.toHaveProperty('threadId');
    expect(result.message.content).toBe(historyMessage.content);
    expect(result.message.id).toBe(historyMessage.id);
    expect(result.nextOffset).toBeNull();
    expect(result.offset).toBe(12000);
  });
  it('surfaces denied reads without retrying under another credential', async () => {
    readMessages.mockRejectedValue(new Error('Operation has already ended'));
    await expect(run(['channel', 'history'])).rejects.toThrow('Operation has already ended');
    expect(readMessages).toHaveBeenCalledTimes(1);
    expect(output).not.toHaveBeenCalled();
  });
});
