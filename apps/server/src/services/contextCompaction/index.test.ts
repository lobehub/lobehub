import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextCompactionService } from './index';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  createCompressionGroup: vi.fn(),
  deleteCompressionGroup: vi.fn(),
  filterGroupIdsByThread: vi.fn(),
  finalizeCompressionGroup: vi.fn(),
  getAgentConfigById: vi.fn(),
  getModelPropertyWithFallback: vi.fn(),
  initModelRuntimeFromDB: vi.fn(),
  queryMessages: vi.fn(),
}));

vi.mock('@/server/services/message', () => ({
  MessageService: class {
    queryMessages = mocks.queryMessages;
  },
}));
vi.mock('@/database/repositories/compression', () => ({
  CompressionRepository: class {
    createCompressionGroup = mocks.createCompressionGroup;
    deleteCompressionGroup = mocks.deleteCompressionGroup;
    filterGroupIdsByThread = mocks.filterGroupIdsByThread;
    finalizeCompressionGroup = mocks.finalizeCompressionGroup;
  },
}));
vi.mock('@/server/services/agent', () => ({
  AgentService: class {
    getAgentConfigById = mocks.getAgentConfigById;
  },
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mocks.initModelRuntimeFromDB,
}));
vi.mock('@lobechat/model-runtime', () => ({
  consumeStreamUntilDone: vi.fn(async () => {}),
  getModelPropertyWithFallback: mocks.getModelPropertyWithFallback,
}));

const scope = { agentId: 'agent-1', groupId: undefined, threadId: undefined, topicId: 'topic-1' };
const settled = [{ content: 'New summary', id: 'cg-new', role: 'compressedGroup' }];

/** History reads walk the `before` cursor; the settled read after finalize has no options. */
const serveHistory = (pages: (before?: { id: string }) => unknown[]) =>
  mocks.queryMessages.mockImplementation(
    async (params: { before?: { id: string } }, options?: { skipToolProjection?: boolean }) =>
      options?.skipToolProjection ? pages(params.before) : settled,
  );

const history = [
  { content: 'Earlier summary', id: 'cg-old', role: 'compressedGroup' },
  { content: 'Plan the migration', id: 'msg-1', role: 'user' },
  { content: 'Here is the plan', id: 'msg-2', role: 'assistant' },
];

const streamSummary = (text: string) =>
  mocks.chat.mockImplementation(async (_payload, options) => {
    options.callback.onText(text);
    return new Response('');
  });

describe('ContextCompactionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serveHistory(() => history);
    mocks.getAgentConfigById.mockResolvedValue({ model: 'gpt-5', provider: 'openai' });
    mocks.initModelRuntimeFromDB.mockResolvedValue({ chat: mocks.chat });
    mocks.createCompressionGroup.mockResolvedValue('cg-new');
    mocks.finalizeCompressionGroup.mockResolvedValue(undefined);
    mocks.deleteCompressionGroup.mockResolvedValue(undefined);
    mocks.filterGroupIdsByThread.mockImplementation(async (ids: string[]) => ids);
    mocks.getModelPropertyWithFallback.mockResolvedValue(128_000);
    streamSummary('  New summary  ');
  });

  it('summarizes live messages server-side and replaces earlier compression groups', async () => {
    const service = new ContextCompactionService({} as never, 'user-1');

    const result = await service.compact({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(mocks.queryMessages).toHaveBeenCalledWith(
      { ...scope, before: undefined },
      { skipToolProjection: true },
    );
    // Only live rows move into the new group; the old group is folded in by summary.
    expect(mocks.createCompressionGroup).toHaveBeenCalledWith({
      content: '...',
      messageIds: ['msg-1', 'msg-2'],
      metadata: { originalMessageCount: 2 },
      topicId: 'topic-1',
    });

    const [payload, options] = mocks.chat.mock.calls[0];
    expect(payload.model).toBe('gpt-5');
    expect(JSON.stringify(payload.messages)).toContain('Earlier summary');
    expect(options.metadata).toEqual({ trigger: RequestTrigger.ContextCompression });
    expect(mocks.initModelRuntimeFromDB).toHaveBeenCalledWith({}, 'user-1', 'openai', undefined);

    expect(mocks.finalizeCompressionGroup).toHaveBeenCalledWith({
      content: 'New summary',
      groupId: 'cg-new',
      sourceGroupIds: ['cg-old'],
      topicId: 'topic-1',
    });
    expect(result).toEqual({ messageGroupId: 'cg-new', messages: settled, skipped: false });
  });

  it('never folds in or supersedes compression groups of another thread', async () => {
    serveHistory(() => [
      { content: 'Main-line summary', id: 'cg-main', role: 'compressedGroup' },
      { content: 'Thread summary', id: 'cg-thread', role: 'compressedGroup' },
      { content: 'Main-line parent', id: 'msg-parent', role: 'user' },
      { content: 'Thread question', id: 'msg-t1', role: 'user', threadId: 'thread-1' },
    ]);
    mocks.filterGroupIdsByThread.mockResolvedValue(['cg-thread']);
    const service = new ContextCompactionService({} as never, 'user-1');

    await service.compact({ agentId: 'agent-1', threadId: 'thread-1', topicId: 'topic-1' });

    expect(mocks.filterGroupIdsByThread).toHaveBeenCalledWith(['cg-main', 'cg-thread'], {
      threadId: 'thread-1',
      topicId: 'topic-1',
    });
    // The thread read also returns its main-line parent; that stays on the main line.
    expect(mocks.createCompressionGroup).toHaveBeenCalledWith(
      expect.objectContaining({ messageIds: ['msg-t1'] }),
    );
    const prompt = JSON.stringify(mocks.chat.mock.calls[0][0].messages);
    expect(prompt).toContain('Thread summary');
    expect(prompt).not.toContain('Main-line summary');
    expect(prompt).not.toContain('Main-line parent');
    expect(mocks.finalizeCompressionGroup).toHaveBeenCalledWith(
      expect.objectContaining({ sourceGroupIds: ['cg-thread'] }),
    );
  });

  it('summarizes a history larger than the model budget as a rolling chain of chunks', async () => {
    // 200-token window → 100-token budget; each message alone takes most of it.
    mocks.getModelPropertyWithFallback.mockResolvedValue(200);
    serveHistory(() => [
      { content: 'alpha '.repeat(60), id: 'msg-a', role: 'user' },
      { content: 'bravo '.repeat(60), id: 'msg-b', role: 'assistant' },
    ]);
    let call = 0;
    mocks.chat.mockImplementation(async (_payload, options) => {
      call += 1;
      options.callback.onText(`Summary ${call}`);
      return new Response('');
    });
    const service = new ContextCompactionService({} as never, 'user-1');

    await service.compact({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(mocks.getModelPropertyWithFallback).toHaveBeenCalledWith(
      'gpt-5',
      'contextWindowTokens',
      'openai',
    );
    expect(mocks.chat).toHaveBeenCalledTimes(2);
    const first = JSON.stringify(mocks.chat.mock.calls[0][0].messages);
    const second = JSON.stringify(mocks.chat.mock.calls[1][0].messages);
    expect(first).toContain('alpha');
    expect(first).not.toContain('bravo');
    // The second chunk carries the first chunk's summary forward.
    expect(second).toContain('Summary 1');
    expect(second).toContain('bravo');
    expect(second).not.toContain('alpha');
    expect(mocks.finalizeCompressionGroup).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Summary 2' }),
    );
  });

  it('compacts history older than the newest query page', async () => {
    const olderPage = [
      { content: 'Kickoff: why migrate', createdAt: 1000, id: 'msg-0a', role: 'user' },
      { content: 'Constraints recap', createdAt: 2000, id: 'msg-0b', role: 'assistant' },
    ];
    const newestPage = history.map((message, index) => ({ ...message, createdAt: 3000 + index }));
    serveHistory((before) => {
      if (!before) return newestPage;
      if (before.id === 'msg-1') return olderPage;
      return [];
    });
    const service = new ContextCompactionService({} as never, 'user-1');

    await service.compact({ agentId: 'agent-1', topicId: 'topic-1' });

    // Walks the round cursor from the oldest raw row of each page.
    const historyReads = mocks.queryMessages.mock.calls.filter(([, options]) => options);
    expect(historyReads.map(([params]) => params.before)).toEqual([
      undefined,
      { createdAt: new Date(3001), id: 'msg-1' },
      { createdAt: new Date(1000), id: 'msg-0a' },
    ]);
    expect(mocks.createCompressionGroup.mock.calls[0][0].messageIds).toEqual([
      'msg-0a',
      'msg-0b',
      'msg-1',
      'msg-2',
    ]);
    expect(JSON.stringify(mocks.chat.mock.calls[0][0].messages)).toContain('Kickoff: why migrate');
  });

  it('fails instead of compacting part of a topic that exceeds the page cap', async () => {
    let createdAt = 1_000_000;
    serveHistory(() => [
      { content: 'more', createdAt: createdAt--, id: `msg-${createdAt}`, role: 'user' },
    ]);
    const service = new ContextCompactionService({} as never, 'user-1');

    await expect(service.compact({ agentId: 'agent-1', topicId: 'topic-1' })).rejects.toThrow(
      'exceeds 20 history pages',
    );
    expect(mocks.createCompressionGroup).not.toHaveBeenCalled();
  });

  it('compacts a history that ends exactly on the page cap', async () => {
    // 20 one-row pages, then the sentinel read comes back empty.
    serveHistory((before) => {
      const index = before ? Number(before.id.slice(4)) - 1 : 20;
      return index >= 1
        ? [{ content: 'row', createdAt: index, id: `msg-${index}`, role: 'user' }]
        : [];
    });
    const service = new ContextCompactionService({} as never, 'user-1');

    const result = await service.compact({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(result.skipped).toBe(false);
    expect(mocks.createCompressionGroup.mock.calls[0][0].messageIds).toHaveLength(20);
  });

  it('skips when every message is already compacted', async () => {
    serveHistory(() => [history[0]]);
    const service = new ContextCompactionService({} as never, 'user-1');

    const result = await service.compact({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(result).toEqual({ messages: [history[0]], skipped: true });
    expect(mocks.createCompressionGroup).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it('skips when the agent has no model to summarize with', async () => {
    mocks.getAgentConfigById.mockResolvedValue({ model: 'gpt-5' });
    const service = new ContextCompactionService({} as never, 'user-1');

    const result = await service.compact({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(result.skipped).toBe(true);
    expect(mocks.createCompressionGroup).not.toHaveBeenCalled();
  });

  it('rolls the placeholder group back when the summary call fails', async () => {
    mocks.chat.mockRejectedValue(new Error('provider down'));
    const service = new ContextCompactionService({} as never, 'user-1');

    await expect(service.compact({ agentId: 'agent-1', topicId: 'topic-1' })).rejects.toThrow(
      'provider down',
    );

    expect(mocks.deleteCompressionGroup).toHaveBeenCalledWith('cg-new');
    expect(mocks.finalizeCompressionGroup).not.toHaveBeenCalled();
  });

  it('rolls back when the stream reports an in-band error after partial text', async () => {
    mocks.chat.mockImplementation(async (_payload, options) => {
      options.callback.onText('Partial summ');
      options.callback.onError({ message: 'upstream overloaded' });
      return new Response('');
    });
    const service = new ContextCompactionService({} as never, 'user-1');

    await expect(service.compact({ agentId: 'agent-1', topicId: 'topic-1' })).rejects.toThrow(
      'upstream overloaded',
    );

    expect(mocks.deleteCompressionGroup).toHaveBeenCalledWith('cg-new');
    expect(mocks.finalizeCompressionGroup).not.toHaveBeenCalled();
  });

  it('forwards cancellation to the model call and never finalizes a cancelled compaction', async () => {
    const controller = new AbortController();
    mocks.chat.mockImplementation(async (_payload, options) => {
      options.callback.onText('Complete summary');
      controller.abort();
      return new Response('');
    });
    const service = new ContextCompactionService({} as never, 'user-1');

    await expect(
      service.compact({ agentId: 'agent-1', topicId: 'topic-1' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(mocks.chat.mock.calls[0][1].signal).toBe(controller.signal);
    expect(mocks.deleteCompressionGroup).toHaveBeenCalledWith('cg-new');
    expect(mocks.finalizeCompressionGroup).not.toHaveBeenCalled();
  });

  it('deletes the finalized group when the settled list cannot be read back', async () => {
    mocks.queryMessages.mockImplementation(async (_params, options) => {
      if (options?.skipToolProjection) return history;
      throw new RangeError('Maximum call stack size exceeded');
    });
    const service = new ContextCompactionService({} as never, 'user-1');

    await expect(service.compact({ agentId: 'agent-1', topicId: 'topic-1' })).rejects.toThrow(
      'Maximum call stack size exceeded',
    );

    // The topic must stay readable: the unrenderable group does not survive.
    expect(mocks.finalizeCompressionGroup).toHaveBeenCalled();
    expect(mocks.deleteCompressionGroup).toHaveBeenCalledWith('cg-new');
  });

  it('rolls back instead of persisting an empty summary', async () => {
    streamSummary('   ');
    const service = new ContextCompactionService({} as never, 'user-1');

    await expect(service.compact({ agentId: 'agent-1', topicId: 'topic-1' })).rejects.toThrow(
      'empty summary',
    );

    expect(mocks.deleteCompressionGroup).toHaveBeenCalledWith('cg-new');
    expect(mocks.finalizeCompressionGroup).not.toHaveBeenCalled();
  });
});
