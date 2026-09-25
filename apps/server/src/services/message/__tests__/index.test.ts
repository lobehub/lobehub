import { type LobeChatDatabase } from '@lobechat/database';
import type * as ToolViewModelModule from '@lobechat/tool-view-model';
import { projectToolViewModels } from '@lobechat/tool-view-model';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { FileService } from '@/server/services/file';

import { MessageService } from '../index';

vi.mock('@/database/models/message');
vi.mock('@/server/services/file');

// Spy on the real projector pipeline rather than stubbing it: the assertion
// that matters is that the UI read path runs it at all, and that with an empty
// registry it is still a pass-through.
vi.mock('@lobechat/tool-view-model', async (importOriginal) => {
  const actual = await importOriginal<typeof ToolViewModelModule>();
  return { ...actual, projectToolViewModels: vi.fn(actual.projectToolViewModels) };
});

describe('MessageService', () => {
  let messageService: MessageService;
  let mockDB: LobeChatDatabase;
  let mockMessageModel: MessageModel;
  let mockFileService: FileService;
  const userId = 'test-user-id';

  beforeEach(() => {
    mockDB = {} as LobeChatDatabase;
    mockMessageModel = {
      create: vi.fn(),
      deleteMessage: vi.fn(),
      deleteMessages: vi.fn(),
      query: vi.fn(),
      update: vi.fn(),
      updateMessagePlugin: vi.fn(),
      updateMessageRAG: vi.fn(),
      updateMetadata: vi.fn(),
      updatePluginState: vi.fn(),
      updateToolMessage: vi.fn(),
    } as any;

    mockFileService = {
      getFullFileUrl: vi.fn().mockImplementation(function (path) {
        return Promise.resolve(`/files${path}`);
      }),
    } as any;

    // Mock constructors
    vi.mocked(MessageModel).mockImplementation(function () {
      return mockMessageModel;
    });
    vi.mocked(FileService).mockImplementation(function () {
      return mockFileService;
    });

    messageService = new MessageService(mockDB, userId);
  });

  describe('prepareUiMessages', () => {
    it('derives nested UI views without changing raw model data', async () => {
      mockFileService.getFileAccessUrl = vi.fn(async (file) => `/proxy/${file.id}`);
      const tool = {
        content: 'FULL TOOL RESULT',
        id: 'tool',
        role: 'tool',
        plugin: { apiName: 'crawlSinglePage', arguments: '{}', identifier: 'lobe-web-browsing' },
        pluginState: { results: [] },
        imageList: [{ id: 'image', url: 'raw/image', width: 42 }],
        audioList: [{ id: 'audio', url: 'raw/audio', durationMs: 123 }],
        videoList: [{ id: 'video', url: 'raw/video' }],
        fileList: [{ id: 'hidden', inaccessible: true, url: '' }],
      };
      const raw = [
        {
          id: 'group',
          role: 'assistant',
          columns: [[tool]],
          members: [tool],
          compressedMessages: [tool],
        },
      ] as any;
      const before = structuredClone(raw);
      const [ui] = await messageService.prepareUiMessages(raw);
      for (const nested of [ui.columns![0][0], ui.members![0], ui.compressedMessages![0]]) {
        // The push path never projects: a pushed snapshot only ever reaches a
        // client that did not declare protocol 2, and it has no way to fetch
        // an omitted payload back.
        expect(nested.content).toBe('FULL TOOL RESULT');
        expect(nested.imageList![0]).toEqual({ id: 'image', url: '/proxy/image', width: 42 });
        expect(nested.audioList![0]).toEqual({
          id: 'audio',
          url: '/proxy/audio',
          durationMs: 123,
        });
        expect(nested.videoList![0].url).toBe('/proxy/video');
        expect(nested.fileList![0].url).toBe('');
      }
      expect(raw).toEqual(before);
      expect(mockFileService.getFileAccessUrl).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 'hidden' }),
      );
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });
  });

  describe('queryMessages', () => {
    const toolRow = {
      content: 'RAW BODY',
      id: 'tool-1',
      plugin: { apiName: 'crawlSinglePage', arguments: '{}', identifier: 'lobe-web-browsing' },
      pluginState: { results: [] },
      role: 'tool',
    } as any;

    it('hands back the stored payloads: only the caller knows if a model reads them', async () => {
      vi.mocked(mockMessageModel.query).mockResolvedValue([toolRow]);

      const result = await messageService.queryMessages({ topicId: 'topic-1' });

      // The projection decision belongs to the read's caller (`message.getMessages`
      // takes `projectToolPayloads`), because a browser-executed run assembles
      // its LLM context from this very list.
      expect(projectToolViewModels).not.toHaveBeenCalled();
      expect(result).toEqual([toolRow]);
    });

    it('passes the share-visitor scope through to the model read', async () => {
      vi.mocked(mockMessageModel.query).mockResolvedValue([toolRow]);

      await messageService.queryMessages({ topicId: 'topic-1' }, { allowShareVisitor: true });

      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { topicId: 'topic-1' },
        expect.objectContaining({ allowShareVisitor: true }),
      );
    });
  });

  describe('removeMessage', () => {
    it('should delete message and return { success: true } when no sessionId/topicId provided', async () => {
      const messageId = 'msg-1';

      const result = await messageService.removeMessage(messageId);

      expect(mockMessageModel.deleteMessage).toHaveBeenCalledWith(messageId);
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should delete message and return message list when sessionId provided', async () => {
      const messageId = 'msg-1';
      const mockMessages = [{ id: 'msg-2', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.removeMessage(messageId, { sessionId: 'session-1' });

      expect(mockMessageModel.deleteMessage).toHaveBeenCalledWith(messageId);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId: undefined, sessionId: 'session-1', topicId: undefined },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('should delete message and return message list when topicId provided', async () => {
      const messageId = 'msg-1';
      const mockMessages = [{ id: 'msg-2', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.removeMessage(messageId, { topicId: 'topic-1' });

      expect(mockMessageModel.deleteMessage).toHaveBeenCalledWith(messageId);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId: undefined, sessionId: undefined, topicId: 'topic-1' },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('removeMessages', () => {
    it('should delete messages and return { success: true } when no sessionId/topicId provided', async () => {
      const messageIds = ['msg-1', 'msg-2'];

      const result = await messageService.removeMessages(messageIds);

      expect(mockMessageModel.deleteMessages).toHaveBeenCalledWith(messageIds);
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should delete messages and return message list when sessionId provided', async () => {
      const messageIds = ['msg-1', 'msg-2'];
      const mockMessages = [{ id: 'msg-3', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.removeMessages(messageIds, { sessionId: 'session-1' });

      expect(mockMessageModel.deleteMessages).toHaveBeenCalledWith(messageIds);
      expect(mockMessageModel.query).toHaveBeenCalled();
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('updateMessageRAG', () => {
    it('should update RAG and return { success: true } when no sessionId/topicId provided', async () => {
      const messageId = 'msg-1';
      const ragValue = { fileChunks: [{ id: 'chunk-1', similarity: 0.95 }] };

      const result = await messageService.updateMessageRAG(messageId, ragValue);

      expect(mockMessageModel.updateMessageRAG).toHaveBeenCalledWith(messageId, ragValue);
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should update RAG and return message list when sessionId provided', async () => {
      const messageId = 'msg-1';
      const ragValue = { fileChunks: [{ id: 'chunk-1', similarity: 0.95 }] };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMessageRAG(messageId, ragValue, {
        sessionId: 'session-1',
      });

      expect(mockMessageModel.updateMessageRAG).toHaveBeenCalledWith(messageId, ragValue);
      expect(mockMessageModel.query).toHaveBeenCalled();
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('updatePluginError', () => {
    it('should update plugin error and return { success: true } when no sessionId/topicId provided', async () => {
      const messageId = 'msg-1';
      const error = { type: 'TestError', message: 'Test error message' };

      const result = await messageService.updatePluginError(messageId, error);

      expect(mockMessageModel.updateMessagePlugin).toHaveBeenCalledWith(messageId, { error });
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should update plugin error and return message list when sessionId provided', async () => {
      const messageId = 'msg-1';
      const error = { type: 'TestError', message: 'Test error message' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updatePluginError(messageId, error, {
        sessionId: 'session-1',
      });

      expect(mockMessageModel.updateMessagePlugin).toHaveBeenCalledWith(messageId, { error });
      expect(mockMessageModel.query).toHaveBeenCalled();
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('updatePluginState', () => {
    it('should update plugin state and return { success: true } when no sessionId/topicId provided', async () => {
      const messageId = 'msg-1';
      const state = { key: 'value' };

      const result = await messageService.updatePluginState(messageId, state, {});

      expect(mockMessageModel.updatePluginState).toHaveBeenCalledWith(messageId, state);
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should update plugin state and return message list when sessionId provided', async () => {
      const messageId = 'msg-1';
      const state = { key: 'value' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updatePluginState(messageId, state, {
        sessionId: 'session-1',
      });

      expect(mockMessageModel.updatePluginState).toHaveBeenCalledWith(messageId, state);
      expect(mockMessageModel.query).toHaveBeenCalled();
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('updateMessage', () => {
    it('normalizes a known error from a legacy client before persistence', async () => {
      await messageService.updateMessage(
        'msg-error',
        {
          error: { body: { message: 'insufficient quota' }, type: 'ProviderBizError' },
        },
        {},
      );
      expect(mockMessageModel.update).toHaveBeenCalledWith('msg-error', {
        error: expect.objectContaining({ attribution: 'user', type: 'InsufficientQuota' }),
      });
    });

    it('preserves an explicit error clear', async () => {
      await messageService.updateMessage('msg-error', { error: null }, {});
      expect(mockMessageModel.update).toHaveBeenCalledWith('msg-error', { error: null });
    });

    it('should update message and return { success: true } when no sessionId/topicId provided', async () => {
      const messageId = 'msg-1';
      const value = { content: 'updated content' };

      const result = await messageService.updateMessage(messageId, value as any, {});

      expect(mockMessageModel.update).toHaveBeenCalledWith(messageId, value);
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should update message and return message list when sessionId provided', async () => {
      const messageId = 'msg-1';
      const value = { content: 'updated content' };
      const mockMessages = [{ id: 'msg-1', content: 'updated content' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMessage(messageId, value as any, {
        sessionId: 'session-1',
      });

      expect(mockMessageModel.update).toHaveBeenCalledWith(messageId, value);
      expect(mockMessageModel.query).toHaveBeenCalled();
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('batchMutate', () => {
    it('normalizes known errors on creation and batched updates too', async () => {
      vi.mocked(mockMessageModel.create).mockResolvedValue({ id: 'msg-error' } as any);
      vi.mocked(mockMessageModel.update).mockResolvedValue({ success: true } as any);
      const error = { type: 'ProviderBizError' as const, body: { message: 'insufficient quota' } };
      const message = { content: '', error, role: 'assistant' as const };
      await messageService.createMessage(message);
      await messageService.batchMutate([
        { type: 'createMessage', message },
        { type: 'updateMessage', id: 'msg-error', value: { error } },
      ]);
      const normalized = expect.objectContaining({
        error: expect.objectContaining({ type: 'InsufficientQuota', attribution: 'user' }),
      });
      expect(mockMessageModel.create).toHaveBeenNthCalledWith(1, normalized, undefined);
      expect(mockMessageModel.create).toHaveBeenNthCalledWith(2, normalized, undefined);
      expect(mockMessageModel.update).toHaveBeenCalledWith('msg-error', normalized);
      expect(message.error).toBe(error);
    });

    it('quietly applies create/update/tool updates without querying messages', async () => {
      vi.mocked(mockMessageModel.create).mockResolvedValue({ id: 'msg-created' } as any);
      vi.mocked(mockMessageModel.update).mockResolvedValue({ success: true } as any);
      vi.mocked(mockMessageModel.updateToolMessage).mockResolvedValue({ success: true } as any);

      const result = await messageService.batchMutate([
        {
          message: { content: '', id: 'msg-created', role: 'assistant', topicId: 'topic-1' } as any,
          type: 'createMessage',
        },
        {
          id: 'msg-created',
          type: 'updateMessage',
          value: { content: 'hello' } as any,
        },
        {
          id: 'tool-1',
          type: 'updateToolMessage',
          value: { content: 'tool result' },
        },
      ]);

      expect(mockMessageModel.create).toHaveBeenCalledWith(
        { content: '', id: 'msg-created', role: 'assistant', topicId: 'topic-1' },
        'msg-created',
      );
      expect(mockMessageModel.update).toHaveBeenCalledWith('msg-created', { content: 'hello' });
      expect(mockMessageModel.updateToolMessage).toHaveBeenCalledWith('tool-1', {
        content: 'tool result',
      });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
      expect(result).toEqual({
        results: [
          { id: 'msg-created', index: 0, success: true, type: 'createMessage' },
          { id: 'msg-created', index: 1, success: true, type: 'updateMessage' },
          { id: 'tool-1', index: 2, success: true, type: 'updateToolMessage' },
        ],
        success: true,
      });
    });

    it('returns per-operation failures without throwing away later operations', async () => {
      vi.mocked(mockMessageModel.create).mockRejectedValueOnce(new Error('create failed'));
      vi.mocked(mockMessageModel.update).mockResolvedValue({ success: true } as any);

      const result = await messageService.batchMutate([
        {
          message: { content: '', id: 'missing-assistant', role: 'assistant' } as any,
          type: 'createMessage',
        },
        {
          id: 'still-runs',
          type: 'updateMessage',
          value: { content: 'still runs' } as any,
        },
      ]);

      expect(mockMessageModel.update).toHaveBeenCalledWith('still-runs', {
        content: 'still runs',
      });
      expect(result).toEqual({
        results: [
          {
            error: 'create failed',
            id: 'missing-assistant',
            index: 0,
            success: false,
            type: 'createMessage',
          },
          { id: 'still-runs', index: 1, success: true, type: 'updateMessage' },
        ],
        success: false,
      });
    });

    it('surfaces the driver cause of a failed write, not the drizzle query wrapper', async () => {
      // Drizzle wraps the driver error: its own message is the whole failed
      // statement + params, while the actionable part (violated constraint,
      // SQLSTATE) only lives on `cause`. A subagent row written ahead of its
      // parent lands here, and the caller needs to see *why* to act on it.
      const driverError = Object.assign(
        new Error('insert or update on table "messages" violates foreign key constraint'),
        { code: '23503', constraint: 'messages_parent_id_messages_id_fk' },
      );
      const drizzleError = Object.assign(new Error('Failed query: insert into "messages" ...'), {
        cause: driverError,
      });
      vi.mocked(mockMessageModel.create).mockRejectedValueOnce(drizzleError);

      const result = await messageService.batchMutate([
        {
          message: { content: '', id: 'orphan', parentId: 'not-yet-written', role: 'user' } as any,
          type: 'createMessage',
        },
      ]);

      expect(result.success).toBe(false);
      expect(result.results[0].error).toBe(
        'messages_parent_id_messages_id_fk | 23503 | insert or update on table "messages" violates foreign key constraint',
      );
    });
  });

  describe('updateMetadata', () => {
    it('should update metadata and return { success: true } when no sessionId/topicId provided', async () => {
      const messageId = 'msg-1';
      const metadata = { someKey: 'someValue', count: 42 };

      const result = await messageService.updateMetadata(messageId, metadata);

      expect(mockMessageModel.updateMetadata).toHaveBeenCalledWith(messageId, metadata);
      expect(result).toEqual({ success: true });
      expect(mockMessageModel.query).not.toHaveBeenCalled();
    });

    it('should update metadata and return message list when sessionId provided', async () => {
      const messageId = 'msg-1';
      const metadata = { someKey: 'someValue', count: 42 };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMetadata(messageId, metadata, {
        sessionId: 'session-1',
      });

      expect(mockMessageModel.updateMetadata).toHaveBeenCalledWith(messageId, metadata);
      expect(mockMessageModel.query).toHaveBeenCalled();
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('should update metadata and return message list when topicId provided', async () => {
      const messageId = 'msg-1';
      const metadata = { key: 'value' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMetadata(messageId, metadata, {
        topicId: 'topic-1',
      });

      expect(mockMessageModel.updateMetadata).toHaveBeenCalledWith(messageId, metadata);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId: undefined, sessionId: undefined, topicId: 'topic-1' },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });

  describe('createMessage', () => {
    it('should create message and return message list', async () => {
      const params = {
        agentId: 'agent-1',
        content: 'Hello',
        role: 'user' as const,
      };
      const createdMessage = { id: 'msg-1', ...params };
      const mockMessages = [createdMessage, { id: 'msg-2', content: 'Hi' }];

      vi.mocked(mockMessageModel.create).mockResolvedValue(createdMessage as any);
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.createMessage(params as any);

      expect(mockMessageModel.create).toHaveBeenCalledWith(params, undefined);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        {
          agentId: 'agent-1',
          current: 0,
          groupId: undefined,
          pageSize: 9999,
          threadId: undefined,
          topicId: undefined,
        },
        expect.objectContaining({
          postProcessUrl: expect.any(Function),
        }),
      );
      expect(result).toEqual({
        id: 'msg-1',
        messages: mockMessages,
      });
    });

    it('should create message with topicId and groupId', async () => {
      const params = {
        agentId: 'agent-1',
        content: 'Hello',
        groupId: 'group-1',
        role: 'user' as const,
        topicId: 'topic-1',
      };
      const createdMessage = { id: 'msg-1', ...params };
      const mockMessages = [createdMessage];

      vi.mocked(mockMessageModel.create).mockResolvedValue(createdMessage as any);
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.createMessage(params as any);

      expect(mockMessageModel.query).toHaveBeenCalledWith(
        {
          agentId: 'agent-1',
          current: 0,
          groupId: 'group-1',
          pageSize: 9999,
          threadId: undefined,
          topicId: 'topic-1',
        },
        expect.objectContaining({
          postProcessUrl: expect.any(Function),
        }),
      );
      expect(result.id).toBe('msg-1');
      expect(result.messages).toEqual(mockMessages);
    });

    it('should create message with threadId and query thread messages', async () => {
      const params = {
        agentId: 'agent-1',
        content: 'Hello in thread',
        groupId: 'group-1',
        role: 'user' as const,
        threadId: 'thread-1',
        topicId: 'topic-1',
      };
      const createdMessage = { id: 'msg-1', ...params };
      const mockMessages = [createdMessage];

      vi.mocked(mockMessageModel.create).mockResolvedValue(createdMessage as any);
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.createMessage(params as any);

      expect(mockMessageModel.create).toHaveBeenCalledWith(params, undefined);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        {
          agentId: 'agent-1',
          current: 0,
          groupId: 'group-1',
          pageSize: 9999,
          threadId: 'thread-1',
          topicId: 'topic-1',
        },
        expect.objectContaining({
          postProcessUrl: expect.any(Function),
        }),
      );
      expect(result.id).toBe('msg-1');
      expect(result.messages).toEqual(mockMessages);
    });
  });

  describe('groupId context support', () => {
    const groupId = 'group-123';
    const topicId = 'topic-456';

    it('removeMessage should query with groupId when provided', async () => {
      const messageId = 'msg-1';
      const mockMessages = [{ id: 'msg-2', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.removeMessage(messageId, { groupId, topicId });

      expect(mockMessageModel.deleteMessage).toHaveBeenCalledWith(messageId);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('removeMessages should query with groupId when provided', async () => {
      const messageIds = ['msg-1', 'msg-2'];
      const mockMessages = [{ id: 'msg-3', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.removeMessages(messageIds, { groupId, topicId });

      expect(mockMessageModel.deleteMessages).toHaveBeenCalledWith(messageIds);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('updateMessage should query with groupId when provided', async () => {
      const messageId = 'msg-1';
      const value = { content: 'updated content' };
      const mockMessages = [{ id: 'msg-1', content: 'updated content' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMessage(messageId, value as any, {
        groupId,
        topicId,
      });

      expect(mockMessageModel.update).toHaveBeenCalledWith(messageId, value);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('updateMetadata should query with groupId when provided', async () => {
      const messageId = 'msg-1';
      const metadata = { key: 'value' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMetadata(messageId, metadata, {
        groupId,
        topicId,
      });

      expect(mockMessageModel.updateMetadata).toHaveBeenCalledWith(messageId, metadata);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('updatePluginState should query with groupId when provided', async () => {
      const messageId = 'msg-1';
      const state = { key: 'value' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updatePluginState(messageId, state, {
        groupId,
        topicId,
      });

      expect(mockMessageModel.updatePluginState).toHaveBeenCalledWith(messageId, state);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('updatePluginError should query with groupId when provided', async () => {
      const messageId = 'msg-1';
      const error = { type: 'TestError', message: 'Test error message' };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updatePluginError(messageId, error, {
        groupId,
        topicId,
      });

      expect(mockMessageModel.updateMessagePlugin).toHaveBeenCalledWith(messageId, { error });
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });

    it('updateMessageRAG should query with groupId when provided', async () => {
      const messageId = 'msg-1';
      const ragValue = { fileChunks: [{ id: 'chunk-1', similarity: 0.95 }] };
      const mockMessages = [{ id: 'msg-1', content: 'test' }];
      vi.mocked(mockMessageModel.query).mockResolvedValue(mockMessages as any);

      const result = await messageService.updateMessageRAG(messageId, ragValue, {
        groupId,
        topicId,
      });

      expect(mockMessageModel.updateMessageRAG).toHaveBeenCalledWith(messageId, ragValue);
      expect(mockMessageModel.query).toHaveBeenCalledWith(
        { groupId, sessionId: undefined, topicId },
        expect.objectContaining({
          groupAssistantMessages: false,
        }),
      );
      expect(result).toEqual({ messages: mockMessages, success: true });
    });
  });
});
