import { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';
import { ragService } from '@/services/rag';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { chatSelectors } from '@/store/chat/selectors';
import { systemAgentSelectors } from '@/store/user/selectors';
import { QueryRewriteSystemAgent } from '@/types/user/settings';

import { useChatStore } from '../../../../store';

// Mock services
vi.mock('@/services/chat', () => ({
  chatService: {
    fetchPresetTaskResult: vi.fn(),
  },
}));

vi.mock('@/services/rag', () => ({
  ragService: {
    deleteMessageRagQuery: vi.fn(),
    semanticSearchForChat: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('chatRAG actions', () => {
  describe('deleteUserMessageRagQuery', () => {
    it('should not delete if message not found', async () => {
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.deleteUserMessageRagQuery('non-existent-id');
      });

      expect(ragService.deleteMessageRagQuery).not.toHaveBeenCalled();
    });

    it('should not delete if message has no ragQueryId', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';

      act(() => {
        useChatStore.setState({
          messagesMap: {
            default: [{ id: messageId }] as UIChatMessage[],
          },
        });
      });

      await act(async () => {
        await result.current.deleteUserMessageRagQuery(messageId);
      });

      expect(ragService.deleteMessageRagQuery).not.toHaveBeenCalled();
    });
  });

  describe('internal_retrieveChunks', () => {
    it('should retrieve chunks with existing ragQuery', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const existingRagQuery = 'existing-query';
      const userQuery = 'user-query';

      // Mock the message with existing ragQuery
      vi.spyOn(chatSelectors, 'getMessageById').mockReturnValue(
        () =>
          ({
            id: messageId,
            ragQuery: existingRagQuery,
          }) as UIChatMessage,
      );

      // Mock the semantic search response
      (ragService.semanticSearchForChat as Mock).mockResolvedValue({
        chunks: [{ id: 'chunk-1' }],
        queryId: 'query-id',
      });

      vi.spyOn(agentSelectors, 'currentKnowledgeIds').mockReturnValue({
        fileIds: [],
        knowledgeBaseIds: [],
      });

      const result1 = await act(async () => {
        return await result.current.internal_retrieveChunks(messageId, userQuery, []);
      });

      expect(result1).toEqual({
        chunks: [{ id: 'chunk-1' }],
        queryId: 'query-id',
        rewriteQuery: existingRagQuery,
      });
      expect(ragService.semanticSearchForChat).toHaveBeenCalledWith(
        expect.objectContaining({
          rewriteQuery: existingRagQuery,
          userQuery,
        }),
      );
    });

    it('should rewrite query if no existing ragQuery', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const userQuery = 'user-query';
      const rewrittenQuery = 'rewritten-query';

      // Mock the message without ragQuery
      vi.spyOn(chatSelectors, 'getMessageById').mockReturnValue(
        () =>
          ({
            id: messageId,
          }) as UIChatMessage,
      );

      // Mock the rewrite query function
      vi.spyOn(result.current, 'internal_rewriteQuery').mockResolvedValueOnce(rewrittenQuery);

      // Mock the semantic search response
      (ragService.semanticSearchForChat as Mock).mockResolvedValue({
        chunks: [{ id: 'chunk-1' }],
        queryId: 'query-id',
      });

      vi.spyOn(agentSelectors, 'currentKnowledgeIds').mockReturnValue({
        fileIds: [],
        knowledgeBaseIds: [],
      });

      const result2 = await act(async () => {
        return await result.current.internal_retrieveChunks(messageId, userQuery, ['message']);
      });

      expect(result2).toEqual({
        chunks: [{ id: 'chunk-1' }],
        queryId: 'query-id',
        rewriteQuery: rewrittenQuery,
      });
      expect(result.current.internal_rewriteQuery).toHaveBeenCalledWith(messageId, userQuery, [
        'message',
      ]);
    });
  });

  describe('internal_rewriteQuery', () => {
    it('should return original content if query rewrite is disabled', async () => {
      const { result } = renderHook(() => useChatStore());
      const content = 'original content';

      vi.spyOn(systemAgentSelectors, 'queryRewrite').mockReturnValueOnce({
        enabled: false,
      } as QueryRewriteSystemAgent);

      const rewrittenQuery = await result.current.internal_rewriteQuery('id', content, []);

      expect(rewrittenQuery).toBe(content);
      expect(chatService.fetchPresetTaskResult).not.toHaveBeenCalled();
    });

    it('should rewrite query if enabled', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const content = 'original content';
      const rewrittenContent = 'rewritten content';

      vi.spyOn(systemAgentSelectors, 'queryRewrite').mockReturnValueOnce({
        enabled: true,
        model: 'gpt-3.5',
        provider: 'openai',
      });

      (chatService.fetchPresetTaskResult as Mock).mockImplementation(({ onFinish }) => {
        onFinish(rewrittenContent);
      });

      const rewrittenQuery = await result.current.internal_rewriteQuery(messageId, content, []);

      expect(rewrittenQuery).toBe(rewrittenContent);
      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
    });
  });

  describe('internal_shouldUseRAG', () => {
    it('should return true if has enabled knowledge', () => {
      const { result } = renderHook(() => useChatStore());

      vi.spyOn(agentSelectors, 'hasEnabledKnowledge').mockReturnValue(true);
      vi.spyOn(chatSelectors, 'currentUserFiles').mockReturnValue([]);

      expect(result.current.internal_shouldUseRAG()).toBe(true);
    });

    it('should return false if has user files', () => {
      const { result } = renderHook(() => useChatStore());

      vi.spyOn(agentSelectors, 'hasEnabledKnowledge').mockReturnValue(false);
      vi.spyOn(chatSelectors, 'currentUserFiles').mockReturnValue([{ id: 'file-1' }] as any);

      expect(result.current.internal_shouldUseRAG()).toBeFalsy();
    });

    it('should return false if no knowledge or files', () => {
      const { result } = renderHook(() => useChatStore());

      vi.spyOn(agentSelectors, 'hasEnabledKnowledge').mockReturnValue(false);
      vi.spyOn(chatSelectors, 'currentUserFiles').mockReturnValue([]);

      expect(result.current.internal_shouldUseRAG()).toBe(false);
    });
  });

  describe('rewriteQuery', () => {
    it('should not rewrite if message not found', async () => {
      const { result } = renderHook(() => useChatStore());

      vi.spyOn(chatSelectors, 'getMessageById').mockReturnValue(() => undefined);
      const rewriteSpy = vi.spyOn(result.current, 'internal_rewriteQuery');

      await act(async () => {
        await result.current.rewriteQuery('non-existent-id');
      });

      expect(rewriteSpy).not.toHaveBeenCalled();
    });

    it('should rewrite query for existing message', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const content = 'message content';

      vi.spyOn(chatSelectors, 'getMessageById').mockReturnValue(
        () =>
          ({
            id: messageId,
            content,
          }) as UIChatMessage,
      );

      vi.spyOn(chatSelectors, 'mainAIChatsWithHistoryConfig').mockReturnValue([
        { content: 'history' },
      ] as UIChatMessage[]);

      const rewriteSpy = vi.spyOn(result.current, 'internal_rewriteQuery');
      const deleteSpy = vi.spyOn(result.current, 'deleteUserMessageRagQuery');

      await act(async () => {
        await result.current.rewriteQuery(messageId);
      });

      expect(deleteSpy).toHaveBeenCalledWith(messageId);
      expect(rewriteSpy).toHaveBeenCalledWith(messageId, content, ['history']);
    });
  });
});
