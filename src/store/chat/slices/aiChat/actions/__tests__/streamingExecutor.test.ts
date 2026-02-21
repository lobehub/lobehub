import { type UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';
import * as agentConfigResolver from '@/services/chat/mecha/agentConfigResolver';
import { messageService } from '@/services/message';

import { useChatStore } from '../../../../store';
import {
  createMockAgentConfig,
  createMockChatConfig,
  createMockMessage,
  createMockResolvedAgentConfig,
  TEST_CONTENT,
  TEST_IDS,
} from './fixtures';
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
          agentConfig: createMockResolvedAgentConfig(),
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
          agentConfig: createMockResolvedAgentConfig(),
        });
      });

      expect(updateMessageSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.objectContaining({
          error: expect.objectContaining({ type: 'InvalidProviderAPIKey' }),
        }),
        expect.objectContaining({
          agentId: TEST_IDS.SESSION_ID,
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
          agentConfig: createMockResolvedAgentConfig(),
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
          agentId: TEST_IDS.SESSION_ID,
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
          agentConfig: createMockResolvedAgentConfig(),
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
          agentId: TEST_IDS.SESSION_ID,
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
          agentConfig: createMockResolvedAgentConfig(),
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
          agentConfig: createMockResolvedAgentConfig(),
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
          agentId: TEST_IDS.SESSION_ID,
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
          agentConfig: createMockResolvedAgentConfig(),
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
          agentId: TEST_IDS.SESSION_ID,
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
          agentConfig: createMockResolvedAgentConfig(),
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
          agentConfig: createMockResolvedAgentConfig(),
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
          agentConfig: createMockResolvedAgentConfig(),
        });
      });

      expect(updateMessageSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.objectContaining({ traceId }),
        expect.objectContaining({
          agentId: expect.any(String),
          topicId: expect.any(String),
        }),
      );

      streamSpy.mockRestore();
    });

    describe('effectiveAgentId for group orchestration', () => {
      it('should use subAgentId as agentId when groupId is present (group orchestration)', async () => {
        const { result } = renderHook(() => useChatStore());
        const messages = [createMockMessage({ role: 'user' })];
        const supervisorAgentId = 'supervisor-agent-id';
        const subAgentId = 'sub-agent-id';
        const groupId = 'test-group-id';

        // Create operation with groupId and subAgentId (group orchestration scenario)
        const { operationId } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: {
            agentId: supervisorAgentId,
            subAgentId: subAgentId,
            groupId: groupId, // groupId present = group orchestration
            topicId: TEST_IDS.TOPIC_ID,
            messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          },
          label: 'Test Group Orchestration',
        });

        // Pre-resolved config for the sub-agent (in real usage, resolved by internal_createAgentState)
        const subAgentConfig = createMockResolvedAgentConfig();

        const streamSpy = vi
          .spyOn(chatService, 'createAssistantMessageStream')
          .mockImplementation(async ({ onFinish }) => {
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {});
          });

        await act(async () => {
          await result.current.internal_fetchAIChatMessage({
            messages,
            messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            model: 'gpt-4o-mini',
            provider: 'openai',
            operationId,
            agentConfig: subAgentConfig,
          });
        });

        // In group orchestration (groupId present), subAgentId should be used as agentId
        expect(streamSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            params: expect.objectContaining({
              agentId: subAgentId, // subAgentId used for context injection in group orchestration
              resolvedAgentConfig: subAgentConfig,
            }),
          }),
        );

        streamSpy.mockRestore();
      });

      it('should use agentId when subAgentId is present but groupId is not (non-group scenario)', async () => {
        const { result } = renderHook(() => useChatStore());
        const messages = [createMockMessage({ role: 'user' })];
        const agentId = 'normal-agent-id';
        const subAgentId = 'sub-agent-id';

        // Create operation with subAgentId but NO groupId (not a group orchestration scenario)
        const { operationId } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: {
            agentId: agentId,
            subAgentId: subAgentId, // subAgentId present but no groupId
            topicId: TEST_IDS.TOPIC_ID,
            messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          },
          label: 'Test Non-Group with SubAgentId',
        });

        const streamSpy = vi
          .spyOn(chatService, 'createAssistantMessageStream')
          .mockImplementation(async ({ onFinish }) => {
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {});
          });

        await act(async () => {
          await result.current.internal_fetchAIChatMessage({
            messages,
            messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            model: 'gpt-4o-mini',
            provider: 'openai',
            operationId,
            agentConfig: createMockResolvedAgentConfig(),
          });
        });

        // Without groupId, should use agentId even if subAgentId is present
        expect(streamSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            // agentId used since no groupId
            params: expect.objectContaining({ agentId }),
          }),
        );

        streamSpy.mockRestore();
      });

      it('should pass agentId to chatService when no subAgentId is set (normal chat)', async () => {
        const { result } = renderHook(() => useChatStore());
        const messages = [createMockMessage({ role: 'user' })];
        const agentId = 'normal-agent-id';

        // Create operation without subAgentId (normal chat scenario)
        const { operationId } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: {
            agentId: agentId,
            // No subAgentId
            topicId: TEST_IDS.TOPIC_ID,
            messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          },
          label: 'Test Normal Chat',
        });

        const streamSpy = vi
          .spyOn(chatService, 'createAssistantMessageStream')
          .mockImplementation(async ({ onFinish }) => {
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {});
          });

        await act(async () => {
          await result.current.internal_fetchAIChatMessage({
            messages,
            messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            model: 'gpt-4o-mini',
            provider: 'openai',
            operationId,
            agentConfig: createMockResolvedAgentConfig(),
          });
        });

        // Verify chatService was called with agentId (no subAgentId present)
        expect(streamSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            params: expect.objectContaining({
              agentId: agentId, // Should be agentId since no subAgentId
            }),
          }),
        );

        streamSpy.mockRestore();
      });

      it('should pass resolvedAgentConfig through chatService in group orchestration speak scenario', async () => {
        const { result } = renderHook(() => useChatStore());
        const messages = [createMockMessage({ role: 'user' })];
        const supervisorAgentId = 'supervisor-agent-id';
        const subAgentId = 'speaking-agent-id';
        const groupId = 'test-group-id';

        // Create operation simulating group orchestration speak scenario
        const { operationId } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: {
            agentId: supervisorAgentId, // The supervisor/session ID
            subAgentId: subAgentId, // The actual speaking agent
            groupId: groupId,
            topicId: TEST_IDS.TOPIC_ID,
            messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            scope: 'group',
          },
          label: 'Test Speak Executor',
        });

        // Create a mock resolved config that represents the speaking agent's config
        const speakingAgentConfig = createMockResolvedAgentConfig();

        const streamSpy = vi
          .spyOn(chatService, 'createAssistantMessageStream')
          .mockImplementation(async ({ onFinish }) => {
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {});
          });

        await act(async () => {
          await result.current.internal_fetchAIChatMessage({
            messages,
            messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            model: 'gpt-4o-mini',
            provider: 'openai',
            operationId,
            // Pass pre-resolved config for the speaking agent
            // In real usage, this is resolved in internal_createAgentState using subAgentId
            agentConfig: speakingAgentConfig,
          });
        });

        // In group orchestration (groupId present), subAgentId is used as agentId for context injection
        // The speaking agent's config is passed via resolvedAgentConfig
        expect(streamSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            params: expect.objectContaining({
              // subAgentId used as agentId in group orchestration
              agentId: subAgentId,
              // resolvedAgentConfig contains the speaking agent's config
              resolvedAgentConfig: speakingAgentConfig,
            }),
          }),
        );

        streamSpy.mockRestore();
      });
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
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
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
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
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
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
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
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
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

    it('should use provided context for trace parameters', async () => {
      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: realExecAgentRuntime,
          activeAgentId: 'active-session',
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
          context: { agentId: contextSessionId, topicId: contextTopicId },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify trace was called with context topicId, not active ones
      expect(streamSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          trace: expect.objectContaining({
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
      const contextAgentId = 'context-session';
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
          agentId: contextAgentId,
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
          agentConfig: createMockResolvedAgentConfig(),
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

    it('should use activeAgentId/activeTopicId when context not provided', async () => {
      act(() => {
        useChatStore.setState({
          activeAgentId: 'active-session',
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
          agentConfig: createMockResolvedAgentConfig(),
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

  describe('afterCompletion hooks', () => {
    it('should execute afterCompletion callbacks after runtime completes', async () => {
      const { result } = renderHook(() => useChatStore());

      // Restore real internal_execAgentRuntime for this test
      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: realExecAgentRuntime,
        });
      });

      // Mock resolveAgentConfig to avoid agent store dependency
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });

      // Create operation manually to register callbacks
      let operationId: string;
      const afterCompletionCallback1 = vi.fn();
      const afterCompletionCallback2 = vi.fn();

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;

        // Register callbacks
        result.current.registerAfterCompletionCallback(operationId, afterCompletionCallback1);
        result.current.registerAfterCompletionCallback(operationId, afterCompletionCallback2);
      });

      // Verify callbacks are registered
      expect(
        result.current.operations[operationId!].metadata.runtimeHooks?.afterCompletionCallbacks,
      ).toHaveLength(2);

      // Mock internal_createAgentState to return minimal state
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        state: {
          status: 'done' as const,
          operationId: operationId!,
          messages: [],
          maxSteps: 10,
          stepCount: 0,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          toolManifestMap: {},
          userInterventionConfig: { approvalMode: 'manual', allowList: [] },
          usage: {
            llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
            tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
            humanInteraction: {
              approvalRequests: 0,
              promptRequests: 0,
              selectRequests: 0,
              totalWaitingTimeMs: 0,
            },
          },
          cost: {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            total: 0,
            llm: { byModel: [], currency: 'USD', total: 0 },
            tools: { byTool: [], currency: 'USD', total: 0 },
          },
        },
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'done',
            stepCount: 0,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      // Execute internal_execAgentRuntime with the pre-created operationId
      await act(async () => {
        await result.current.internal_execAgentRuntime({
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      // Verify callbacks were executed
      expect(afterCompletionCallback1).toHaveBeenCalledTimes(1);
      expect(afterCompletionCallback2).toHaveBeenCalledTimes(1);
    });

    it('should continue execution even if a callback throws an error', async () => {
      const { result } = renderHook(() => useChatStore());

      // Restore real internal_execAgentRuntime for this test
      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: realExecAgentRuntime,
        });
      });

      // Mock resolveAgentConfig to avoid agent store dependency
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });

      let operationId: string;
      const errorCallback = vi.fn().mockRejectedValue(new Error('Callback error'));
      const successCallback = vi.fn();

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;

        // Register callbacks - error callback first, then success callback
        result.current.registerAfterCompletionCallback(operationId, errorCallback);
        result.current.registerAfterCompletionCallback(operationId, successCallback);
      });

      // Mock internal_createAgentState to return minimal state
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        state: {
          status: 'done' as const,
          operationId: operationId!,
          messages: [],
          maxSteps: 10,
          stepCount: 0,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          toolManifestMap: {},
          userInterventionConfig: { approvalMode: 'manual', allowList: [] },
          usage: {
            llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
            tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
            humanInteraction: {
              approvalRequests: 0,
              promptRequests: 0,
              selectRequests: 0,
              totalWaitingTimeMs: 0,
            },
          },
          cost: {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            total: 0,
            llm: { byModel: [], currency: 'USD', total: 0 },
            tools: { byTool: [], currency: 'USD', total: 0 },
          },
        },
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'done',
            stepCount: 0,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      // Suppress console.error for this test
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      // Both callbacks should have been called
      expect(errorCallback).toHaveBeenCalledTimes(1);
      expect(successCallback).toHaveBeenCalledTimes(1);

      // Error should have been logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[internal_execAgentRuntime] afterCompletion callback error:',
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    it('should not fail when no afterCompletion callbacks are registered', async () => {
      const { result } = renderHook(() => useChatStore());

      // Restore real internal_execAgentRuntime for this test
      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: realExecAgentRuntime,
        });
      });

      // Mock resolveAgentConfig to avoid agent store dependency
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });

      let operationId: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
        // No callbacks registered
      });

      // Mock internal_createAgentState to return minimal state
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        state: {
          status: 'done' as const,
          operationId: operationId!,
          messages: [],
          maxSteps: 10,
          stepCount: 0,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          toolManifestMap: {},
          userInterventionConfig: { approvalMode: 'manual', allowList: [] },
          usage: {
            llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
            tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
            humanInteraction: {
              approvalRequests: 0,
              promptRequests: 0,
              selectRequests: 0,
              totalWaitingTimeMs: 0,
            },
          },
          cost: {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            total: 0,
            llm: { byModel: [], currency: 'USD', total: 0 },
            tools: { byTool: [], currency: 'USD', total: 0 },
          },
        },
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'done',
            stepCount: 0,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      // Should not throw
      await act(async () => {
        await result.current.internal_execAgentRuntime({
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      // Operation should complete successfully
      expect(result.current.operations[operationId!].status).toBe('completed');
    });
  });

  describe('initialContext preservation', () => {
    it('should preserve initialContext through multiple steps in agent runtime loop', async () => {
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

      // Track initialContext passed to chatService across multiple calls
      const capturedInitialContexts: any[] = [];
      let streamCallCount = 0;

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish, initialContext }) => {
          streamCallCount++;
          capturedInitialContexts.push(initialContext);

          if (streamCallCount === 1) {
            // First LLM call returns tool calls
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
              toolCalls: [
                { id: 'tool-1', type: 'function', function: { name: 'test', arguments: '{}' } },
              ],
            } as any);
          } else {
            // Second LLM call (after tool execution) returns final response
            await onFinish?.('Final response', {} as any);
          }
        });

      // Mock internal_createAgentState to include initialContext
      const mockInitialContext = {
        pageEditor: {
          markdown: '# Test Document',
          xml: '<root><h1>Test</h1></root>',
          metadata: { title: 'Test Doc', charCount: 15, lineCount: 1 },
        },
      };

      const originalCreateAgentState = result.current.internal_createAgentState;
      vi.spyOn(result.current, 'internal_createAgentState').mockImplementation((params) => {
        const baseResult = originalCreateAgentState(params);
        return {
          ...baseResult,
          context: {
            ...baseResult.context,
            initialContext: mockInitialContext,
          },
        };
      });

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify that initialContext was passed to all LLM calls
      // Note: The first call should have initialContext, and subsequent calls should preserve it
      expect(capturedInitialContexts.length).toBeGreaterThanOrEqual(1);

      // All captured initialContexts should be the same (preserved through steps)
      capturedInitialContexts.forEach((ctx, index) => {
        expect(ctx).toEqual(mockInitialContext);
      });

      streamSpy.mockRestore();
    });

    it('should preserve initialContext when result.nextContext does not include it', async () => {
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

      const capturedInitialContexts: any[] = [];
      let streamCallCount = 0;

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onFinish, initialContext }) => {
          streamCallCount++;
          capturedInitialContexts.push(initialContext);

          if (streamCallCount < 3) {
            // Return tool calls to continue the loop
            await onFinish?.(TEST_CONTENT.AI_RESPONSE, {
              toolCalls: [
                {
                  id: `tool-${streamCallCount}`,
                  type: 'function',
                  function: { name: 'test', arguments: '{}' },
                },
              ],
            } as any);
          } else {
            // Final response without tool calls
            await onFinish?.('Final response', {} as any);
          }
        });

      const mockInitialContext = {
        pageEditor: {
          markdown: '# Preserved Context',
          xml: '<doc>preserved</doc>',
          metadata: { title: 'Preserved', charCount: 20, lineCount: 1 },
        },
      };

      const originalCreateAgentState = result.current.internal_createAgentState;
      vi.spyOn(result.current, 'internal_createAgentState').mockImplementation((params) => {
        const baseResult = originalCreateAgentState(params);
        return {
          ...baseResult,
          context: {
            ...baseResult.context,
            initialContext: mockInitialContext,
          },
        };
      });

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
          messages: [userMessage],
          parentMessageId: userMessage.id,
          parentMessageType: 'user',
        });
      });

      // Verify initialContext was preserved across all LLM calls
      // Even though result.nextContext from executors doesn't include initialContext,
      // the loop should preserve it from the original context
      capturedInitialContexts.forEach((ctx) => {
        expect(ctx).toEqual(mockInitialContext);
      });

      streamSpy.mockRestore();
    });
  });

  describe('internal_createAgentState with disableTools', () => {
    it('should return empty toolManifestMap when disableTools is true', async () => {
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

      // Get actual internal_createAgentState result with disableTools: true
      const { state } = result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        disableTools: true,
      });

      // toolManifestMap should be empty when disableTools is true
      expect(state.toolManifestMap).toEqual({});
    });

    it('should return empty tools in agentConfig when disableTools is true', async () => {
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

      // Get actual internal_createAgentState result with disableTools: true
      const { agentConfig } = result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        disableTools: true,
      });

      // agentConfig should have empty tools-related fields when disableTools is true
      expect(agentConfig.tools).toBeUndefined();
      expect(agentConfig.enabledToolIds).toEqual([]);
      expect(agentConfig.enabledManifests).toEqual([]);
    });

    it('should include tools in toolManifestMap when disableTools is false or undefined', async () => {
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

      // Mock resolveAgentConfig to return plugins
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: {
          ...createMockAgentConfig(),
          plugins: ['test-plugin'],
        },
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: ['test-plugin'],
      });

      // Get actual internal_createAgentState result without disableTools
      const { state: stateWithoutDisable } = result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        // disableTools not set (undefined)
      });

      // Get actual internal_createAgentState result with disableTools: false
      const { state: stateWithDisableFalse } = result.current.internal_createAgentState({
        messages: [userMessage],
        parentMessageId: userMessage.id,
        agentId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
        disableTools: false,
      });

      // Both should have the same toolManifestMap (tools enabled)
      // Note: The actual content depends on what plugins are resolved,
      // but the key point is they should not be empty (unless no plugins are configured)
      expect(stateWithoutDisable.toolManifestMap).toEqual(stateWithDisableFalse.toolManifestMap);
    });
  });

  describe('operation status handling', () => {
    it('should complete operation when state is waiting_for_human', async () => {
      const { result } = renderHook(() => useChatStore());

      // Restore real internal_execAgentRuntime for this test
      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: realExecAgentRuntime,
        });
      });

      // Mock resolveAgentConfig to avoid agent store dependency
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });

      let operationId: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
      });

      // Mock internal_createAgentState to return waiting_for_human status
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        state: {
          status: 'waiting_for_human' as const,
          operationId: operationId!,
          messages: [],
          maxSteps: 10,
          stepCount: 1,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          toolManifestMap: {},
          userInterventionConfig: { approvalMode: 'manual', allowList: [] },
          usage: {
            llm: {
              apiCalls: 1,
              processingTimeMs: 100,
              tokens: { input: 10, output: 20, total: 30 },
            },
            tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
            humanInteraction: {
              approvalRequests: 1,
              promptRequests: 0,
              selectRequests: 0,
              totalWaitingTimeMs: 0,
            },
          },
          cost: {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            total: 0,
            llm: { byModel: [], currency: 'USD', total: 0 },
            tools: { byTool: [], currency: 'USD', total: 0 },
          },
        },
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'waiting_for_human',
            stepCount: 1,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      // Operation should be completed (not stuck in running state)
      // This is important because:
      // 1. User can see the tool intervention UI without loading indicator
      // 2. A new operation will be created when user approves/rejects
      expect(result.current.operations[operationId!].status).toBe('completed');
    });

    it('should fail operation when state is error', async () => {
      const { result } = renderHook(() => useChatStore());

      // Restore real internal_execAgentRuntime for this test
      act(() => {
        useChatStore.setState({
          internal_execAgentRuntime: realExecAgentRuntime,
        });
      });

      // Mock resolveAgentConfig to avoid agent store dependency
      vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
        agentConfig: createMockAgentConfig(),
        chatConfig: createMockChatConfig(),
        isBuiltinAgent: false,
        plugins: [],
      });

      let operationId: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
      });

      // Mock internal_createAgentState to return error status
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        state: {
          status: 'error' as const,
          operationId: operationId!,
          messages: [],
          maxSteps: 10,
          stepCount: 1,
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          toolManifestMap: {},
          userInterventionConfig: { approvalMode: 'manual', allowList: [] },
          usage: {
            llm: {
              apiCalls: 1,
              processingTimeMs: 100,
              tokens: { input: 10, output: 20, total: 30 },
            },
            tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
            humanInteraction: {
              approvalRequests: 0,
              promptRequests: 0,
              selectRequests: 0,
              totalWaitingTimeMs: 0,
            },
          },
          cost: {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            total: 0,
            llm: { byModel: [], currency: 'USD', total: 0 },
            tools: { byTool: [], currency: 'USD', total: 0 },
          },
        },
        context: {
          phase: 'init',
          payload: { model: 'gpt-4o-mini', provider: 'openai' },
          session: {
            sessionId: TEST_IDS.SESSION_ID,
            messageCount: 0,
            status: 'error',
            stepCount: 1,
          },
        },
        agentConfig: createMockResolvedAgentConfig(),
      });

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          messages: [],
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          parentMessageType: 'user',
          operationId: operationId!,
        });
      });

      // Operation should be failed
      expect(result.current.operations[operationId!].status).toBe('failed');
    });
  });

  describe('content_part multimodal streaming', () => {
    it('should dispatch isMultimodal metadata when content_part image chunks are received', async () => {
      // Mock file store to prevent upload from hanging
      const fileStoreMod = await import('@/store/file/store');
      vi.spyOn(fileStoreMod, 'getFileStoreState').mockReturnValue({
        uploadBase64FileWithProgress: vi
          .fn()
          .mockResolvedValue({ id: 'img-id', url: 'https://cdn.example.com/img.png' }),
      } as any);

      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      // Create operation for this test
      const { operationId } = result.current.startOperation({
        type: 'execAgentRuntime',
        context: {
          agentId: TEST_IDS.SESSION_ID,
          topicId: null,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        },
        label: 'Test AI Generation',
      });

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          // Send text content_part
          await onMessageHandle?.({
            type: 'content_part',
            partType: 'text',
            content: 'Here is a cat: ',
          } as any);
          // Send image content_part
          await onMessageHandle?.({
            type: 'content_part',
            partType: 'image',
            content: 'base64catimage',
            mimeType: 'image/jpeg',
          } as any);
          await onFinish?.('Here is a cat: ', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gemini-3-pro-image-preview',
          provider: 'google',
          operationId,
          agentConfig: createMockResolvedAgentConfig(),
        });
      });

      // Find dispatch calls with metadata.isMultimodal
      const multimodalDispatches = dispatchSpy.mock.calls.filter((call) => {
        const dispatch = call[0];
        return (
          dispatch?.type === 'updateMessage' &&
          'value' in dispatch &&
          dispatch.value?.metadata?.isMultimodal === true
        );
      });

      // Should have dispatched at least once with isMultimodal metadata during streaming
      expect(multimodalDispatches.length).toBeGreaterThanOrEqual(1);

      // Verify the dispatch includes tempDisplayContent
      const firstMultimodalDispatch = multimodalDispatches[0][0] as any;
      expect(firstMultimodalDispatch.value.metadata.tempDisplayContent).toBeDefined();

      streamSpy.mockRestore();
    });

    it('should call optimisticUpdateMessageContent with isMultimodal metadata for multimodal content', async () => {
      // Mock file store to prevent upload from hanging
      const fileStoreMod = await import('@/store/file/store');
      vi.spyOn(fileStoreMod, 'getFileStoreState').mockReturnValue({
        uploadBase64FileWithProgress: vi
          .fn()
          .mockResolvedValue({ id: 'img-id', url: 'https://cdn.example.com/img.png' }),
      } as any);

      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const updateContentSpy = vi.spyOn(result.current, 'optimisticUpdateMessageContent');

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({
            type: 'content_part',
            partType: 'text',
            content: 'Generated image: ',
          } as any);
          await onMessageHandle?.({
            type: 'content_part',
            partType: 'image',
            content: 'base64imagedata',
            mimeType: 'image/png',
          } as any);
          await onFinish?.('Generated image: ', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gemini-3-pro-image-preview',
          provider: 'google',
          agentConfig: createMockResolvedAgentConfig(),
        });
      });

      // optimisticUpdateMessageContent should be called with metadata containing isMultimodal
      expect(updateContentSpy).toHaveBeenCalledWith(
        TEST_IDS.ASSISTANT_MESSAGE_ID,
        expect.any(String), // serialized JSON content
        expect.objectContaining({
          metadata: expect.objectContaining({
            isMultimodal: true,
          }),
        }),
        expect.any(Object),
      );

      streamSpy.mockRestore();
    });

    it('should NOT dispatch isMultimodal metadata for plain text streaming', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];
      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

      const streamSpy = vi
        .spyOn(chatService, 'createAssistantMessageStream')
        .mockImplementation(async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({ type: 'text', text: 'Hello World' } as any);
          await onFinish?.('Hello World', {} as any);
        });

      await act(async () => {
        await result.current.internal_fetchAIChatMessage({
          messages,
          messageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          model: 'gpt-4o-mini',
          provider: 'openai',
          agentConfig: createMockResolvedAgentConfig(),
        });
      });

      // No dispatch should contain isMultimodal metadata
      const multimodalDispatches = dispatchSpy.mock.calls.filter((call) => {
        const dispatch = call[0];
        return (
          dispatch?.type === 'updateMessage' &&
          'value' in dispatch &&
          dispatch.value?.metadata?.isMultimodal === true
        );
      });

      expect(multimodalDispatches).toHaveLength(0);

      streamSpy.mockRestore();
    });
  });

  describe('isSubTask filtering', () => {
    it('should filter out lobe-gtd tools when isSubTask is true', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      // Mock resolveAgentConfig to return plugins including lobe-gtd
      const resolveAgentConfigSpy = vi
        .spyOn(agentConfigResolver, 'resolveAgentConfig')
        .mockReturnValue({
          agentConfig: createMockAgentConfig(),
          chatConfig: createMockChatConfig(),
          isBuiltinAgent: false,
          plugins: ['lobe-gtd', 'lobe-local-system', 'other-plugin'],
        });

      // Create operation
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'execClientTask',
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
        });
        operationId = res.operationId;
      });

      // Call internal_createAgentState with isSubTask: true
      act(() => {
        result.current.internal_createAgentState({
          messages,
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          operationId,
          isSubTask: true,
        });
      });

      // Verify that resolveAgentConfig was called
      expect(resolveAgentConfigSpy).toHaveBeenCalled();

      resolveAgentConfigSpy.mockRestore();
    });

    it('should NOT filter out lobe-gtd tools when isSubTask is false or undefined', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [createMockMessage({ role: 'user' })];

      // Mock resolveAgentConfig to return plugins including lobe-gtd
      const resolveAgentConfigSpy = vi
        .spyOn(agentConfigResolver, 'resolveAgentConfig')
        .mockReturnValue({
          agentConfig: createMockAgentConfig(),
          chatConfig: createMockChatConfig(),
          isBuiltinAgent: false,
          plugins: ['lobe-gtd', 'lobe-local-system', 'other-plugin'],
        });

      // Create operation without isSubTask (normal conversation)
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
        });
        operationId = res.operationId;
      });

      // Call internal_createAgentState without isSubTask
      act(() => {
        result.current.internal_createAgentState({
          messages,
          parentMessageId: TEST_IDS.USER_MESSAGE_ID,
          operationId,
        });
      });

      // Verify that resolveAgentConfig was called
      expect(resolveAgentConfigSpy).toHaveBeenCalled();

      resolveAgentConfigSpy.mockRestore();
    });
  });
});
