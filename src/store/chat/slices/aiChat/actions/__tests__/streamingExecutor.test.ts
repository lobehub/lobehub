import { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import * as fileStoreModule from '@/store/file/store';

import { useChatStore } from '../../../../store';
import { TEST_CONTENT, TEST_IDS, createMockMessage } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');

const realExecAgentRuntime = useChatStore.getState().internal_execAgentRuntime;

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  spyOnMessageService();

  act(() => {
    useChatStore.setState({
      refreshMessages: vi.fn(),
      internal_execAgentRuntime: vi.fn(),
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StreamingExecutor actions', () => {
  describe('internal_fetchAIChatMessage', () => {
    it('should fetch and return AI chat response', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({ type: 'text', text: TEST_CONTENT.AI_RESPONSE } as any);
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {});
        });

      await act(async () => {
        const response = await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
        expect(response.isFunctionCall).toEqual(false);
        expect(response.content).toEqual(TEST_CONTENT.AI_RESPONSE);
      });

      streamSpy.mockRestore();
    });

    it('should handle streaming errors gracefully', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onErrorHandle }) => {
          await onErrorHandle?.({ type: 'InvalidProviderAPIKey', message: 'Network error' } as any);
        });

      const updateMessageSpy = vi.spyOn(messageService, 'updateMessage');

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          model: 'gpt-4o-mini',
          provider: 'openai',
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        });
      });

      expect(updateMessageSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.objectContaining({
          error: expect.objectContaining({ type: 'InvalidProviderAPIKey' }),
        }),
        expect.objectContaining({
          sessionId: TEST_IDS.SESSION_ID,
          topicId: TEST_IDS.TOPIC_ID,
        }),
      );

      streamSpy.mockRestore();
    });

    it('should handle tool call chunks during streaming', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({
            type: 'tool_calls',
            isAnimationActives: [true],
            tool_calls: [
              { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '{}' } },
            ],
          } as any);
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
            toolCalls: [
              { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '{}' } },
            ],
          } as any);
        });

      await act(async () => {
        const response = await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
        expect(response.isFunctionCall).toEqual(true);
      });

      streamSpy.mockRestore();
    });

    it('should handle text chunks during streaming', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      // Create operation for this test
      const { operationId } = result.current.startOperation({
        type: 'execAgentRuntime',
        context: {
          sessionId: TEST_IDS.SESSION_ID,
          topicId: null,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        },
        label: 'Test AI Generation',
      });

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({ type: 'text', text: 'Hello' } as any);
          await onMessageHandle?.({ type: 'text', text: ' World' } as any);
          await onFinish?.('Hello World', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
          operationId,
        });
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          type: 'updateMessage',
          value: expect.objectContaining({ content: 'Hello' }),
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );

      streamSpy.mockRestore();
    });

    it('should handle reasoning chunks during streaming', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      // Create operation for this test
      const { operationId } = result.current.startOperation({
        type: 'execAgentRuntime',
        context: {
          sessionId: TEST_IDS.SESSION_ID,
          topicId: null,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        },
        label: 'Test AI Generation',
      });

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({ type: 'reasoning', text: 'Thinking...' } as any);
          await onMessageHandle?.({ type: 'text', text: 'Answer' } as any);
          await onFinish?.('Answer', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
          operationId,
        });
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          type: 'updateMessage',
          value: expect.objectContaining({ reasoning: { content: 'Thinking...' } }),
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );

      streamSpy.mockRestore();
    });

    it('should skip grounding when citations are empty', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({
            type: 'grounding',
            grounding: { citations: [], searchQueries: [] },
          } as any);
          await onFinish?.('Answer', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      // Should not dispatch when citations are empty
      const groundingCalls = dispatchSpy.mock.calls.filter((call) => {
        const dispatch = call[0];
        return dispatch?.type === 'updateMessage' && 'value' in dispatch && dispatch.value?.search;
      });
      expect(groundingCalls).toHaveLength(0);

      streamSpy.mockRestore();
    });

    it('should handle grounding chunks during streaming', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      // Create operation for this test
      const { operationId } = result.current.startOperation({
        type: 'execAgentRuntime',
        context: {
          sessionId: TEST_IDS.SESSION_ID,
          topicId: null,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        },
        label: 'Test AI Generation',
      });

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({
            type: 'grounding',
            grounding: {
              citations: [{ url: 'https://example.com', title: 'Example' }],
              searchQueries: ['test query'],
            },
          } as any);
          await onFinish?.('Answer', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
          operationId,
        });
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          type: 'updateMessage',
          value: expect.objectContaining({
            search: expect.objectContaining({
              citations: expect.any(Array),
            }),
          }),
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );

      streamSpy.mockRestore();
    });

    it('should handle base64 image chunks during streaming', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      // Create operation for this test
      const { operationId } = result.current.startOperation({
        type: 'execAgentRuntime',
        context: {
          sessionId: TEST_IDS.SESSION_ID,
          topicId: null,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        },
        label: 'Test AI Generation',
      });

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({
            type: 'base64_image',
            image: { id: 'img-1', data: 'base64data' },
            images: [{ id: 'img-1', data: 'base64data' }],
          } as any);
          await onFinish?.('Answer', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
          operationId,
        });
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          type: 'updateMessage',
          value: expect.objectContaining({
            imageList: expect.any(Array),
          }),
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );

      streamSpy.mockRestore();
    });

    it('should handle content_part image chunks and collect file ids for finalImages', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const optimisticUpdateSpy = vi.spyOn(result.current, 'optimisticUpdateMessageContent');

      // Mock getFileStoreState to return uploadBase64FileWithProgress
      const mockUploadFn = vi.fn().mockResolvedValue({
        id: 'uploaded-file-id',
        url: 'https://example.com/uploaded.png',
        filename: 'uploaded.png',
      });
      const getFileStoreStateSpy = vi
        .spyOn(fileStoreModule, 'getFileStoreState')
        .mockReturnValue({ uploadBase64FileWithProgress: mockUploadFn } as any);

      // Create operation for this test
      const { operationId } = result.current.startOperation({
        type: 'execAgentRuntime',
        context: {
          sessionId: TEST_IDS.SESSION_ID,
          topicId: null,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        },
        label: 'Test AI Generation',
      });

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          // Simulate content_part with image (correct chunk structure)
          await onMessageHandle?.({
            type: 'content_part',
            partType: 'image',
            content: 'base64imagedata',
            mimeType: 'image/png',
          } as any);
          await onFinish?.('Answer with image', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gemini-3-pro-image-preview',
          provider: 'google',
          operationId,
        });
      });

      // Verify upload was called with base64 data
      expect(mockUploadFn).toHaveBeenCalledWith('data:image/png;base64,base64imagedata');

      // Verify optimisticUpdateMessageContent was called with imageList containing file id
      expect(optimisticUpdateSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.any(String), // content
        expect.objectContaining({
          imageList: expect.arrayContaining([
            expect.objectContaining({
              id: 'uploaded-file-id',
              url: 'https://example.com/uploaded.png',
            }),
          ]),
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );

      getFileStoreStateSpy.mockRestore();
      streamSpy.mockRestore();
    });

    it('should handle reasoning_part image chunks and collect file ids for finalImages', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const optimisticUpdateSpy = vi.spyOn(result.current, 'optimisticUpdateMessageContent');

      // Mock getFileStoreState to return uploadBase64FileWithProgress
      const mockUploadFn = vi.fn().mockResolvedValue({
        id: 'reasoning-file-id',
        url: 'https://example.com/reasoning.png',
        filename: 'reasoning.png',
      });
      const getFileStoreStateSpy = vi
        .spyOn(fileStoreModule, 'getFileStoreState')
        .mockReturnValue({ uploadBase64FileWithProgress: mockUploadFn } as any);

      // Create operation for this test
      const { operationId } = result.current.startOperation({
        type: 'execAgentRuntime',
        context: {
          sessionId: TEST_IDS.SESSION_ID,
          topicId: null,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        },
        label: 'Test AI Generation',
      });

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          // Simulate reasoning_part with image (correct chunk structure)
          await onMessageHandle?.({
            type: 'reasoning_part',
            partType: 'image',
            content: 'reasoningbase64data',
            mimeType: 'image/jpeg',
          } as any);
          await onFinish?.('Answer with reasoning image', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gemini-3-pro-image-preview',
          provider: 'google',
          operationId,
        });
      });

      // Verify upload was called with base64 data
      expect(mockUploadFn).toHaveBeenCalledWith('data:image/jpeg;base64,reasoningbase64data');

      // Verify optimisticUpdateMessageContent was called with imageList containing file id
      expect(optimisticUpdateSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.any(String), // content
        expect.objectContaining({
          imageList: expect.arrayContaining([
            expect.objectContaining({
              id: 'reasoning-file-id',
              url: 'https://example.com/reasoning.png',
            }),
          ]),
        }),
        expect.objectContaining({
          operationId: expect.any(String),
        }),
      );

      getFileStoreStateSpy.mockRestore();
      streamSpy.mockRestore();
    });

    it('should handle empty tool call arguments', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
            toolCalls: [
              { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '' } },
            ],
          } as any);
        });

      await act(async () => {
        const response = await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
        expect(response.isFunctionCall).toEqual(true);
      });

      streamSpy.mockRestore();
    });

    it('should update message with traceId when provided in onFinish', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const traceId = 'test-trace-123';

      const updateMessageSpy = vi.spyOn(messageService, 'updateMessage');
      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, { traceId } as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(updateMessageSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.objectContaining({ traceId }),
        expect.objectContaining({
          sessionId: expect.any(String),
          topicId: expect.any(String),
        }),
      );

      streamSpy.mockRestore();
    });
  });

  describe('internal_execAgentRuntime', () => {
    it('should handle the core AI message processing', async () => {
      act(() => {
        useChatStore.setState({ internal_execAgentRuntime: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;
      const messages = [userMessage];

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {} as any);
        });

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          messages,
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify agent runtime executed successfully
      expect(streamSpy).toHaveBeenCalled();

      // Verify operation was completed
      const operations = Object.values(result.current.operations);
      const execOperation = operations.find((op) => op.type === 'execAgentRuntime');
      expect(execOperation?.status).toBe('completed');

      streamSpy.mockRestore();
    });

    it('should stop agent runtime loop when operation is cancelled before step execution', async () => {
      act(() => {
        useChatStore.setState({ internal_execAgentRuntime: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      let streamCallCount = 0;
      let cancelDuringFirstCall = false;
      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          streamCallCount++;

          // Cancel during the first LLM call to simulate mid-execution cancellation
          if (streamCallCount === 1) {
            const operations = Object.values(result.current.operations);
            const execOperation = operations.find((op) => op.type === 'execAgentRuntime');
            if (execOperation) {
              act(() => {
                result.current.cancelOperation(execOperation.id, 'user_cancelled');
              });
              cancelDuringFirstCall = true;
            }
          }

          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
            toolCalls: [
              { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '{}' } },
            ],
          } as any);
        });

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify cancellation happened during execution
      expect(cancelDuringFirstCall).toBe(true);
      // The loop should stop after first call, not continue to second LLM call after tool execution
      expect(streamCallCount).toBe(1);

      streamSpy.mockRestore();
    });

    it('should stop agent runtime loop when operation is cancelled after step completion', async () => {
      act(() => {
        useChatStore.setState({ internal_execAgentRuntime: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      let streamCallCount = 0;
      let cancelledAfterStep = false;

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          streamCallCount++;

          // First call - LLM returns tool calls
          if (streamCallCount === 1) {
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
              toolCalls: [
                { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '{}' } },
              ],
            } as any);

            // Cancel immediately after LLM step completes
            // This triggers the after-step cancellation check
            await new Promise((resolve) => setTimeout(resolve, 20));
            const operations = Object.values(result.current.operations);
            const execOperation = operations.find((op) => op.type === 'execAgentRuntime');
            if (execOperation && execOperation.status === 'running') {
              act(() => {
                result.current.cancelOperation(execOperation.id, 'user_cancelled');
              });
              cancelledAfterStep = true;
            }
          }
        });

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify cancellation happened after step completion
      expect(cancelledAfterStep).toBe(true);

      // Verify that only one LLM call was made (no tool execution happened)
      expect(streamCallCount).toBe(1);

      // Verify the execution stopped and didn't proceed to tool calling
      const operations = Object.values(result.current.operations);
      const toolOperations = operations.filter((op) => op.type === 'toolCalling');

      // If any tool operations were started, they should have been cancelled
      if (toolOperations.length > 0) {
        expect(toolOperations.every((op) => op.status === 'cancelled')).toBe(true);
      }

      streamSpy.mockRestore();
    });

    it('should resolve aborted tools when cancelled after LLM returns tool calls', async () => {
      act(() => {
        useChatStore.setState({ internal_execAgentRuntime: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;

      let cancelledAfterLLM = false;
      let streamCallCount = 0;

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish }) => {
          streamCallCount++;

          // First call - LLM returns with tool calls
          if (streamCallCount === 1) {
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
              toolCalls: [
                {
                  id: 'tool-1',
                  type: 'function',
                  function: { name: 'weatherQuery', arguments: '{"city":"Beijing"}' },
                },
                {
                  id: 'tool-2',
                  type: 'function',
                  function: { name: 'calculator', arguments: '{"expression":"1+1"}' },
                },
              ],
            } as any);

            // User cancels after LLM completes but before tool execution
            await new Promise((resolve) => setTimeout(resolve, 20));
            const operations = Object.values(result.current.operations);
            const execOperation = operations.find((op) => op.type === 'execAgentRuntime');
            if (execOperation && execOperation.status === 'running') {
              act(() => {
                result.current.cancelOperation(execOperation.id, 'user_cancelled');
              });
              cancelledAfterLLM = true;
            }
          }
        });

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify cancellation happened after LLM call
      expect(cancelledAfterLLM).toBe(true);

      // Verify only one LLM call was made (no tool execution happened)
      expect(streamCallCount).toBe(1);

      // Verify the agent runtime completed (not just cancelled mid-flight)
      const operations = Object.values(result.current.operations);
      const execOperation = operations.find((op) => op.type === 'execAgentRuntime');
      expect(execOperation?.status).toBe('completed');

      streamSpy.mockRestore();
    });

    it('should use provided sessionId/topicId for trace parameters', async () => {
      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: realExecAgentRuntime,
          activeId: 'active-session',
          activeTopicId: 'active-topic',
        });
      });

      const { result } = renderHook(() => useChatStore());
      const contextSessionId = 'context-session';
      const contextTopicId = 'context-topic';
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: contextSessionId,
        topicId: contextTopicId,
      } as UIChatMessage;

      const streamSpy = vi.spyOn(chatService, 'createAssistantMessageStream');

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
          sessionId: contextSessionId,
          topicId: contextTopicId,
        });
      });

      // Verify trace was called with context sessionId/topicId, not active ones
      expect(streamSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          trace: expect.objectContaining({
            sessionId: contextSessionId,
            topicId: contextTopicId,
          }),
        }),
      );
    });

    // Note: RAG metadata functionality has been removed
    // RAG is now handled by Knowledge Base Tools (searchKnowledgeBase and readKnowledge)
  });

  describe('StreamingExecutor OptimisticUpdateContext isolation', () => {
    it('should pass context to optimisticUpdateMessageContent in internal_fetchAIChatMessage', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const contextSessionId = 'context-session';
      const contextTopicId = 'context-topic';

      const updateContentSpy = vi.spyOn(result.current, 'optimisticUpdateMessageContent');

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({ type: 'text', text: TEST_CONTENT.AI_RESPONSE } as any);
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {});
        });

      // Create operation with specific context
      const { operationId } = result.current.startOperation({
        type: 'execAgentRuntime',
        context: {
          sessionId: contextSessionId,
          topicId: contextTopicId,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        },
        label: 'Test AI Generation',
      });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
          operationId,
        });
      });

      expect(updateContentSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        TEST_CONTENT.AI_RESPONSE,
        expect.any(Object),
        {
          operationId: expect.any(String),
        },
      );

      streamSpy.mockRestore();
    });

    it('should use activeId/activeTopicId when context not provided', async () => {
      act(() => {
        useChatStore.setState({
          activeId: 'active-session',
          activeTopicId: 'active-topic',
        });
      });

      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      const updateContentSpy = vi.spyOn(result.current, 'optimisticUpdateMessageContent');

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({ type: 'text', text: TEST_CONTENT.AI_RESPONSE } as any);
          await onFinish?.(TEST_CONTENT.AI_RESPONSE, {});
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
        });
      });

      expect(updateContentSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        TEST_CONTENT.AI_RESPONSE,
        expect.any(Object),
        {
          operationId: undefined,
        },
      );

      streamSpy.mockRestore();
    });
  });
});
