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

const {
  listChannels,
  listPeople,
  listThreads,
  messagePerson,
  readMessages,
  readMessage,
  sendMessage,
  output,
} = vi.hoisted(() => ({
  listChannels: vi.fn(),
  listThreads: vi.fn(),
  listPeople: vi.fn(),
  messagePerson: vi.fn(),
  readMessages: vi.fn(),
  readMessage: vi.fn(),
  sendMessage: vi.fn(),
  output: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    channel: {
      listChannels: { query: listChannels },
      listPeople: { query: listPeople },
      listThreads: { query: listThreads },
      messagePerson: { mutate: messagePerson },
      readMessages: { query: readMessages },
      readMessage: { query: readMessage },
      sendMessage: { mutate: sendMessage },
    },
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
    expect(readMessages).toHaveBeenCalledWith({
      beforeSequence: 20,
      limit: 5,
      threadId: undefined,
    });
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
    expect(readMessage).toHaveBeenCalledWith({
      messageId: 'message-id',
      offset: 12000,
      threadId: undefined,
    });
    const result = output.mock.calls[0][0];
    expect(result.message).not.toHaveProperty('sequence');
    expect(result.message).not.toHaveProperty('threadId');
    expect(result.message.content).toBe(historyMessage.content);
    expect(result.message.id).toBe(historyMessage.id);
    expect(result.nextOffset).toBeNull();
    expect(result.offset).toBe(12000);
  });
  it('lists the Channel Threads and reads one by its id', async () => {
    const threads = { nextBefore: null, threads: [] };
    listThreads.mockResolvedValue(threads);
    await run(['channel', 'threads', '--active', '--limit', '3', '--json']);
    expect(listThreads).toHaveBeenCalledWith({ activeOnly: true, before: undefined, limit: 3 });
    expect(output).toHaveBeenCalledWith(threads);

    readMessages.mockResolvedValue({ cutoffSequence: 9, messages: [], nextBeforeSequence: null });
    await run(['channel', 'history', '--thread', 'cht_example', '--json']);
    expect(readMessages).toHaveBeenCalledWith({
      beforeSequence: undefined,
      limit: undefined,
      threadId: 'cht_example',
    });

    readMessage.mockResolvedValue({ message: historyMessage, nextOffset: null, offset: 0 });
    await run(['channel', 'message', 'message-id', '--thread', 'cht_example', '--json']);
    expect(readMessage).toHaveBeenCalledWith({
      messageId: 'message-id',
      offset: undefined,
      threadId: 'cht_example',
    });
  });
  it('surfaces denied reads without retrying under another credential', async () => {
    readMessages.mockRejectedValue(new Error('Operation has already ended'));
    await expect(run(['channel', 'history'])).rejects.toThrow('Operation has already ended');
    expect(readMessages).toHaveBeenCalledTimes(1);
    expect(output).not.toHaveBeenCalled();
  });
  it('lists where Agents can be reached', async () => {
    const page = { channels: [], hasMore: false };
    listChannels.mockResolvedValue(page);
    await run(['channel', 'list', '--agent', 'agent-1', '--query', 'general', '--limit', '3']);
    expect(listChannels).toHaveBeenCalledWith({ agentId: 'agent-1', limit: 3, query: 'general' });
    expect(output).toHaveBeenCalledWith(page);
  });
  it('sends to every --agent with a retry key', async () => {
    sendMessage.mockResolvedValue({ messageId: 'message-sent' });
    await run([
      'channel',
      'send',
      'channel-1',
      '--agent',
      'agent-1',
      '--agent',
      'agent-2',
      '-c',
      'Please take a look',
      '--request-key',
      'retry-1',
    ]);
    expect(sendMessage).toHaveBeenCalledWith({
      agentIds: ['agent-1', 'agent-2'],
      channelId: 'channel-1',
      content: 'Please take a look',
      requestKey: 'retry-1',
    });
    await run(['channel', 'send', 'channel-1', '--agent', 'agent-1', '-c', 'Hi']);
    expect(sendMessage.mock.calls[1][0].requestKey).toMatch(/^[\da-f-]{36}$/);
  });
  it('lists the people the requester can message', async () => {
    const page = { hasMore: false, people: [] };
    listPeople.mockResolvedValue(page);
    await run(['channel', 'people', '--query', 'alice', '--limit', '3', '--json']);
    expect(listPeople).toHaveBeenCalledWith({ limit: 3, query: 'alice' });
    expect(output).toHaveBeenCalledWith(page);
  });
  it('messages one person with a retry key', async () => {
    messagePerson.mockResolvedValue({ messageId: 'message-sent' });
    await run(['channel', 'dm', 'user-alice', '-c', 'T-1 is done', '--request-key', 'retry-1']);
    expect(messagePerson).toHaveBeenCalledWith({
      content: 'T-1 is done',
      requestKey: 'retry-1',
      userId: 'user-alice',
    });
    await run(['channel', 'dm', 'user-alice', '-c', 'Hi']);
    expect(messagePerson.mock.calls[1][0].requestKey).toMatch(/^[\da-f-]{36}$/);
  });
});
