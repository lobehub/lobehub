// @vitest-environment node
import { INBOX_SESSION_ID, LOBE_CHAT_OBSERVATION_ID, LOBE_CHAT_TRACE_ID } from '@lobechat/const';
import { type ChatStreamPayload } from '@lobechat/model-runtime';
import { TraceNameMap, TraceTagMap } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TraceClient } from '@/libs/traces';

import { type AgentChatOptions, createTraceOptions } from './trace';

// Mock dependencies
vi.mock('@/libs/traces', () => ({
  TraceClient: vi.fn(),
}));

vi.mock('next/server', () => ({
  after: vi.fn((callback) => callback()),
}));

describe('createTraceOptions', () => {
  let mockTraceClient: any;
  let mockTrace: any;
  let mockGeneration: any;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Create mock generation object
    mockGeneration = {
      id: 'generation-id-123',
      update: vi.fn(),
    };

    // Create mock trace object
    mockTrace = {
      id: 'trace-id-123',
      generation: vi.fn(() => mockGeneration),
      update: vi.fn(),
    };

    // Create mock trace client
    mockTraceClient = {
      createTrace: vi.fn(() => mockTrace),
      shutdownAsync: vi.fn().mockResolvedValue(undefined),
    };

    // Mock TraceClient constructor
    (TraceClient as any).mockImplementation(() => mockTraceClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('trace creation', () => {
    it('should create trace with correct metadata from payload', () => {
      const payload: ChatStreamPayload = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'Hello' },
        ],
        model: 'gpt-4',
        tools: [{ type: 'function', function: { name: 'test-tool', description: 'A test tool' } }],
        temperature: 0.7,
      };

      const options: AgentChatOptions = {
        enableTrace: true,
        provider: 'openai',
        trace: {
          traceId: 'custom-trace-id',
          traceName: TraceNameMap.Conversation,
          topicId: 'topic-123',
          sessionId: 'session-456',
          userId: 'user-789',
          tags: ['test-tag'],
        },
      };

      createTraceOptions(payload, options);

      expect(mockTraceClient.createTrace).toHaveBeenCalledWith({
        id: 'custom-trace-id',
        input: payload.messages,
        metadata: {
          messageLength: 2,
          model: 'gpt-4',
          provider: 'openai',
          systemRole: 'You are a helpful assistant',
          tools: payload.tools,
        },
        name: TraceNameMap.Conversation,
        sessionId: 'topic-123',
        tags: ['test-tag'],
        userId: 'user-789',
      });
    });

    it('should use default sessionId when topicId and sessionId are not provided', () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      createTraceOptions(payload, options);

      expect(mockTraceClient.createTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: `${INBOX_SESSION_ID}@default`,
        }),
      );
    });

    it('should use sessionId with @default suffix when only sessionId is provided', () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {
          sessionId: 'session-123',
        },
      };

      createTraceOptions(payload, options);

      expect(mockTraceClient.createTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-123@default',
        }),
      );
    });

    it('should extract system role from messages', () => {
      const payload: ChatStreamPayload = {
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'system', content: 'System instructions' },
          { role: 'user', content: 'Second message' },
        ],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      createTraceOptions(payload, options);

      expect(mockTraceClient.createTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            systemRole: 'System instructions',
          }),
        }),
      );
    });
  });

  describe('generation creation', () => {
    it('should create generation with correct parameters', () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
        temperature: 0.7,
        max_tokens: 100,
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      createTraceOptions(payload, options);

      expect(mockTrace.generation).toHaveBeenCalledWith({
        input: payload.messages,
        metadata: {
          messageLength: 1,
          model: 'gpt-4',
          provider: 'openai',
        },
        model: 'gpt-4',
        modelParameters: { temperature: 0.7, max_tokens: 100 },
        name: 'Chat Completion (openai)',
        startTime: expect.any(Date),
      });
    });
  });

  describe('headers', () => {
    it('should set trace and observation headers when IDs are available', () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      expect(result.headers.get(LOBE_CHAT_TRACE_ID)).toBe('trace-id-123');
      expect(result.headers.get(LOBE_CHAT_OBSERVATION_ID)).toBe('generation-id-123');
    });

    it('should not set headers when trace or generation are undefined', () => {
      mockTraceClient.createTrace.mockReturnValue(undefined);

      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      expect(result.headers.get(LOBE_CHAT_TRACE_ID)).toBeNull();
      expect(result.headers.get(LOBE_CHAT_OBSERVATION_ID)).toBeNull();
    });
  });

  describe('callback: onCompletion', () => {
    it('should update generation with text output', async () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      await result.callback.onCompletion!({
        text: 'Hello, how can I help you?',
        usage: {
          inputTextTokens: 10,
          outputTextTokens: 20,
          totalInputTokens: 10,
          totalOutputTokens: 20,
          totalTokens: 30,
        },
      });

      expect(mockGeneration.update).toHaveBeenCalledWith({
        endTime: expect.any(Date),
        metadata: { grounding: undefined, thinking: undefined },
        output: 'Hello, how can I help you?',
        usage: {
          completionTokens: 20,
          input: 10,
          output: 20,
          promptTokens: 10,
          totalTokens: 30,
        },
      });

      expect(mockTrace.update).toHaveBeenCalledWith({
        output: 'Hello, how can I help you?',
      });
    });

    it('should include thinking in output when present', async () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      await result.callback.onCompletion!({
        text: 'Response text',
        thinking: 'Internal reasoning',
        usage: undefined,
      });

      expect(mockGeneration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          output: { text: 'Response text', thinking: 'Internal reasoning' },
          metadata: { grounding: undefined, thinking: 'Internal reasoning' },
        }),
      );
    });

    it('should prioritize toolsCalling in output', async () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      const toolsCalling = [
        {
          id: 'call-123',
          type: 'function' as const,
          function: { name: 'test-tool', arguments: '{}' },
        },
      ];

      await result.callback.onCompletion!({
        text: 'Response text',
        toolsCalling,
        usage: undefined,
      });

      expect(mockGeneration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          output: { text: 'Response text', thinking: undefined, toolsCalling },
        }),
      );
    });

    it('should return only toolsCalling when no text is present', async () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      const toolsCalling = [
        {
          id: 'call-123',
          type: 'function' as const,
          function: { name: 'test-tool', arguments: '{}' },
        },
      ];

      await result.callback.onCompletion!({
        text: '',
        toolsCalling,
        usage: undefined,
      });

      expect(mockGeneration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          output: toolsCalling,
        }),
      );
    });

    it('should handle grounding metadata', async () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      const grounding = {
        groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
      };

      await result.callback.onCompletion!({
        text: 'Response text',
        grounding,
        usage: undefined,
      });

      expect(mockGeneration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { grounding, thinking: undefined },
        }),
      );
    });

    it('should handle missing usage data', async () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      await result.callback.onCompletion!({
        text: 'Response text',
        usage: undefined,
      });

      expect(mockGeneration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          usage: undefined,
        }),
      );
    });
  });

  describe('callback: onStart', () => {
    it('should update generation with completion start time', async () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      await result.callback.onStart!();

      expect(mockGeneration.update).toHaveBeenCalledWith({
        completionStartTime: expect.any(Date),
      });
    });

    it('should handle undefined generation gracefully', () => {
      mockTrace.generation.mockReturnValue(undefined);

      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      expect(() => result.callback.onStart!()).not.toThrow();
    });
  });

  describe('callback: onToolsCalling', () => {
    it('should update trace with ToolsCalling tag', async () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {
          tags: ['existing-tag'],
        },
      };

      const result = createTraceOptions(payload, options);

      await result.callback.onToolsCalling!({
        chunk: [],
        toolsCalling: [],
      });

      expect(mockTrace.update).toHaveBeenCalledWith({
        tags: ['existing-tag', TraceTagMap.ToolsCalling],
      });
    });

    it('should add ToolsCalling tag when no existing tags', async () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      await result.callback.onToolsCalling!({
        chunk: [],
        toolsCalling: [],
      });

      expect(mockTrace.update).toHaveBeenCalledWith({
        tags: [TraceTagMap.ToolsCalling],
      });
    });

    it('should handle undefined trace gracefully', async () => {
      mockTraceClient.createTrace.mockReturnValue(undefined);

      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      await expect(
        result.callback.onToolsCalling!({
          chunk: [],
          toolsCalling: [],
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('callback: onFinal', () => {
    it('should shutdown trace client', async () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      await result.callback.onFinal!({
        text: 'Final response',
        usage: undefined,
      });

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockTraceClient.shutdownAsync).toHaveBeenCalled();
    });

    it('should handle shutdown errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockTraceClient.shutdownAsync.mockRejectedValue(new Error('Shutdown failed'));

      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      await result.callback.onFinal!({
        text: 'Final response',
        usage: undefined,
      });

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'TraceClient shutdown error:',
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle empty messages array', () => {
      const payload: ChatStreamPayload = {
        messages: [],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      createTraceOptions(payload, options);

      expect(mockTraceClient.createTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            messageLength: 0,
            systemRole: undefined,
          }),
        }),
      );
    });

    it('should handle payload without tools', () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      createTraceOptions(payload, options);

      expect(mockTraceClient.createTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            tools: undefined,
          }),
        }),
      );
    });

    it('should handle trace payload without any optional fields', () => {
      const payload: ChatStreamPayload = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4',
      };

      const options: AgentChatOptions = {
        provider: 'openai',
        trace: {},
      };

      const result = createTraceOptions(payload, options);

      expect(result.callback).toBeDefined();
      expect(result.headers).toBeInstanceOf(Headers);
    });
  });
});
