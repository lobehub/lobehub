// @vitest-environment node
import { StructuredOutputError } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType, ChatErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import { aiChatRouter } from '../aiChat';

const objectGenerationRuntime = (generateObject: ReturnType<typeof vi.fn>) => ({ generateObject });

vi.mock('@/server/routers/lambda/_helpers/resolveContext', () => ({
  resolveContext: vi.fn(async (input) => ({
    ...input,
    agentId: input.agentId ?? null,
    sessionId: input.sessionId ?? null,
  })),
}));
vi.mock('@/database/models/agent');
vi.mock('@/database/models/message');
vi.mock('@/database/models/thread');
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    resolveConversationMode = async (_id: string, fallback: string) => fallback;
  },
}));
vi.mock('@/database/repositories/topic');
vi.mock('@/server/services/aiChat');
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

describe('aiChatRouter structured output', () => {
  const mockCtx = { userId: 'u1' };
  describe('outputJSON', () => {
    it('should successfully generate structured output', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');

      const mockResult = { object: { name: 'John', age: 30 } };
      const mockGenerateObject = vi.fn().mockResolvedValue(mockResult);

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        objectGenerationRuntime(mockGenerateObject) as any,
      );

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      const input = {
        messages: [{ content: 'test', role: 'user' }],
        model: 'gpt-4o',
        provider: 'openai',
        schema: {
          name: 'Person',
          schema: {
            type: 'object' as const,
            properties: { name: { type: 'string' }, age: { type: 'number' } },
          },
        },
      };

      const result = await caller.outputJSON(input);

      expect(initModelRuntimeFromDB).toHaveBeenCalledWith({}, 'u1', 'openai', undefined);
      expect(mockGenerateObject).toHaveBeenCalledWith(
        {
          messages: input.messages,
          model: 'gpt-4o',
          schema: input.schema,
          tools: undefined,
        },
        {
          metadata: { trigger: 'chat' },
          tracing: { tracingId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
        },
      );
      expect(result.data).toEqual(mockResult);
      expect(result.tracingId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('maps provider auth runtime errors to UNAUTHORIZED instead of leaking as internal errors', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
      const runtimeError = {
        error: undefined,
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      };

      vi.mocked(initModelRuntimeFromDB).mockRejectedValueOnce(runtimeError);

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      try {
        await caller.outputJSON({
          messages: [{ content: 'test', role: 'user' }],
          model: 'gpt-4o',
          provider: 'openai',
        });
        throw new Error('Expected outputJSON to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect(error).toMatchObject({
          cause: runtimeError,
          code: 'UNAUTHORIZED',
          message: AgentRuntimeErrorType.InvalidProviderAPIKey,
        });
      }
    });

    it('maps known runtime errors with their configured transport status', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
      const runtimeError = {
        error: { message: 'rate limited' },
        errorType: AgentRuntimeErrorType.RateLimitExceeded,
      };

      vi.mocked(initModelRuntimeFromDB).mockRejectedValueOnce(runtimeError);

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      try {
        await caller.outputJSON({
          messages: [{ content: 'test', role: 'user' }],
          model: 'gpt-4o',
          provider: 'openai',
        });
        throw new Error('Expected outputJSON to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect(error).toMatchObject({
          cause: runtimeError,
          code: 'TOO_MANY_REQUESTS',
          message: AgentRuntimeErrorType.RateLimitExceeded,
        });
      }
    });

    it('marks input completion runtime 4xx errors to skip tRPC handler logging', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
      const runtimeError = {
        error: { message: 'rate limited' },
        errorType: AgentRuntimeErrorType.RateLimitExceeded,
      };

      vi.mocked(initModelRuntimeFromDB).mockRejectedValueOnce(runtimeError);

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      try {
        await caller.outputJSON({
          messages: [{ content: 'test', role: 'user' }],
          model: 'gpt-4o',
          provider: 'openai',
          tracing: { scenario: 'input_completion' },
        });
        throw new Error('Expected outputJSON to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((runtimeError as any).__lobeSilentTRPCErrorLog).toBe(true);
      }
    });

    it('does not mark non-input-completion runtime errors as silent', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
      const runtimeError = {
        error: { message: 'rate limited' },
        errorType: AgentRuntimeErrorType.RateLimitExceeded,
      };

      vi.mocked(initModelRuntimeFromDB).mockRejectedValueOnce(runtimeError);

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      try {
        await caller.outputJSON({
          messages: [{ content: 'test', role: 'user' }],
          model: 'gpt-4o',
          provider: 'openai',
          tracing: { scenario: 'topic_title' },
        });
        throw new Error('Expected outputJSON to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((runtimeError as any).__lobeSilentTRPCErrorLog).toBeUndefined();
      }
    });

    it('maps numeric chat error types to their tRPC status', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
      const accessError = {
        error: { message: ChatErrorType.Forbidden },
        errorType: ChatErrorType.Forbidden,
        message: 'Forbidden',
      };
      const mockGenerateObject = vi.fn().mockRejectedValue(accessError);

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        objectGenerationRuntime(mockGenerateObject) as any,
      );

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      try {
        await caller.outputJSON({
          messages: [{ content: 'test', role: 'user' }],
          model: 'claude-fable-5',
          provider: 'lobehub',
        });
        throw new Error('Expected outputJSON to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect(error).toMatchObject({
          cause: accessError,
          code: 'FORBIDDEN',
          message: accessError.message,
        });
      }
    });

    it.each([
      {
        accessError: {
          error: { message: 'Nested forbidden message' },
          errorType: ChatErrorType.Forbidden,
        },
        expectedMessage: 'Nested forbidden message',
        source: 'nested error.message',
      },
      {
        accessError: {
          error: {},
          errorMessage: 'Legacy forbidden message',
          errorType: ChatErrorType.Forbidden,
        },
        expectedMessage: 'Legacy forbidden message',
        source: 'legacy errorMessage',
      },
    ])('preserves $source for numeric chat errors', async ({ accessError, expectedMessage }) => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
      const mockGenerateObject = vi.fn().mockRejectedValue(accessError);

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        objectGenerationRuntime(mockGenerateObject) as any,
      );

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      await expect(
        caller.outputJSON({
          messages: [{ content: 'test', role: 'user' }],
          model: 'claude-fable-5',
          provider: 'lobehub',
        }),
      ).rejects.toMatchObject({
        cause: accessError,
        code: 'FORBIDDEN',
        message: expectedMessage,
      });
    });

    it.each([
      { errorType: 400, expectedCode: 'BAD_REQUEST' },
      { errorType: 418, expectedCode: 'BAD_REQUEST' },
      { errorType: 599, expectedCode: 'INTERNAL_SERVER_ERROR' },
    ])(
      'maps numeric status $errorType to $expectedCode with a generic message',
      async ({ errorType, expectedCode }) => {
        const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
        const accessError = { error: {}, errorType };
        const mockGenerateObject = vi.fn().mockRejectedValue(accessError);

        vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
          objectGenerationRuntime(mockGenerateObject) as any,
        );

        const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

        await expect(
          caller.outputJSON({
            messages: [{ content: 'test', role: 'user' }],
            model: 'claude-fable-5',
            provider: 'lobehub',
          }),
        ).rejects.toMatchObject({
          cause: accessError,
          code: expectedCode,
          message: `Request failed (${errorType})`,
        });
      },
    );

    it('does not silence numeric runtime 5xx errors', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
      const runtimeError = {
        error: { message: 'Provider unavailable' },
        errorType: 503,
      };
      const mockGenerateObject = vi.fn().mockRejectedValue(runtimeError);

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        objectGenerationRuntime(mockGenerateObject) as any,
      );

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      try {
        await caller.outputJSON({
          messages: [{ content: 'test', role: 'user' }],
          model: 'claude-fable-5',
          provider: 'lobehub',
          tracing: { scenario: 'input_completion' },
        });
        throw new Error('Expected outputJSON to throw');
      } catch (error) {
        expect(error).toMatchObject({
          cause: runtimeError,
          code: 'SERVICE_UNAVAILABLE',
          message: runtimeError.error.message,
        });
        expect((runtimeError as any).__lobeSilentTRPCErrorLog).toBeUndefined();
      }
    });

    it.each([399, 600])('does not map out-of-range numeric error type %i', async (errorType) => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
      const runtimeError = { errorType };
      const mockGenerateObject = vi.fn().mockRejectedValue(runtimeError);

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        objectGenerationRuntime(mockGenerateObject) as any,
      );

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      try {
        await caller.outputJSON({
          messages: [{ content: 'test', role: 'user' }],
          model: 'claude-fable-5',
          provider: 'lobehub',
          tracing: { scenario: 'input_completion' },
        });
        throw new Error('Expected outputJSON to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect(error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
        expect((error as Error).message).not.toBe(`Request failed (${errorType})`);
        expect((runtimeError as any).__lobeSilentTRPCErrorLog).toBeUndefined();
      }
    });

    it('maps raw provider 4xx errors to BAD_REQUEST instead of internal errors', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');

      // Raw SDK APIError shape: carries an HTTP status but no errorType — the
      // generateObject path rethrows upstream errors verbatim (e.g. a BYOK
      // gateway rejecting response_format json_schema).
      const providerError = Object.assign(
        new Error(
          '400 Error from provider (DeepSeek): This response_format type is unavailable now',
        ),
        { status: 400 },
      );
      const mockGenerateObject = vi.fn().mockRejectedValue(providerError);

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        objectGenerationRuntime(mockGenerateObject) as any,
      );

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      try {
        await caller.outputJSON({
          messages: [{ content: 'test', role: 'user' }],
          model: 'deepseek-v4-flash-free',
          provider: 'opencodezen',
        });
        throw new Error('Expected outputJSON to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect(error).toMatchObject({
          cause: providerError,
          code: 'BAD_REQUEST',
          message: providerError.message,
        });
      }
    });

    it('should handle tools parameter when provided', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');

      const mockTools = [
        {
          type: 'function' as const,
          function: {
            name: 'test',
            parameters: {
              type: 'object' as const,
              properties: { input: { type: 'string' } },
            },
          },
        },
      ];
      const mockGenerateObject = vi.fn().mockResolvedValue({ object: {} });

      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        objectGenerationRuntime(mockGenerateObject) as any,
      );

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      const input = {
        messages: [],
        model: 'gpt-4o',
        provider: 'openai',
        tools: mockTools,
      };

      await caller.outputJSON(input);

      expect(mockGenerateObject).toHaveBeenCalledWith(
        {
          messages: [],
          model: 'gpt-4o',
          schema: undefined,
          tools: mockTools,
        },
        {
          metadata: { trigger: 'chat' },
          tracing: { tracingId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
        },
      );
    });

    it.each([undefined, 'Mozilla/5.0', 'LobeHub-Mobile/ios-v1.0.5'])(
      'preserves extensible metadata and uses request UA %s',
      async (userAgent) => {
        const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
        const generateObject = vi.fn().mockResolvedValue({ completion: 'ok' });
        vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ generateObject } as any);
        const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {}, userAgent } as any);

        await caller.outputJSON({
          messages: [],
          metadata: {
            correlationId: 'cid-1',
            privateOption: true,
            topicId: 'topic-1',
            trigger: 'custom_feature',
            userAgent: 'LobeHub-Mobile/android-v1.0.5',
          },
          model: 'test-model',
          provider: 'test-provider',
        });

        expect(generateObject.mock.calls[0][1].metadata).toEqual({
          correlationId: 'cid-1',
          privateOption: true,
          topicId: 'topic-1',
          trigger: 'custom_feature',
          userAgent,
        });
      },
    );

    it('merges caller metadata over the default trigger and forwards tracing', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
      const mockGenerateObject = vi.fn().mockResolvedValue({ completion: 'hi there' });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        objectGenerationRuntime(mockGenerateObject) as any,
      );

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);
      const result = await caller.outputJSON({
        messages: [{ content: 'be helpful', role: 'system' }],
        metadata: { correlationId: 'cid-1' },
        model: 'gpt-4o-mini',
        provider: 'openai',
        schema: {
          name: 'InputCompletion',
          schema: {
            additionalProperties: false,
            properties: { completion: { type: 'string' } },
            required: ['completion'],
            type: 'object' as const,
          },
        },
        tracing: {
          promptVersion: 'v2.0',
          scenario: 'input_completion',
          schemaName: 'InputCompletion',
        },
      });

      expect(mockGenerateObject.mock.calls[0][1]).toEqual({
        metadata: { correlationId: 'cid-1', trigger: 'chat' },
        tracing: {
          promptVersion: 'v2.0',
          scenario: 'input_completion',
          schemaName: 'InputCompletion',
          tracingId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        },
      });
      expect(result.tracingId).toMatch(/^[0-9a-f-]{36}$/);
    });

    describe('unparsable structured output', () => {
      const inputCompletionInput = {
        messages: [{ content: 'complete: hello', role: 'user' }],
        model: 'gpt-4o-mini',
        provider: 'openai',
        schema: {
          name: 'input_completion',
          schema: {
            properties: { completion: { type: 'string' } },
            type: 'object' as const,
          },
        },
        tracing: { scenario: 'input_completion' },
      };

      it('returns an empty result instead of an internal error in schema mode', async () => {
        const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
        vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
          generateObject: vi
            .fn()
            .mockRejectedValue(new StructuredOutputError('invalid JSON response text')),
        } as any);

        const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);
        const result = await caller.outputJSON(inputCompletionInput);

        expect(result.data).toBeUndefined();
        expect(result.tracingId).toMatch(/^[0-9a-f-]{36}$/);
      });

      it('still throws in tool mode, where a missing tool call was already an error', async () => {
        const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
        const structuredError = new StructuredOutputError('no tool calls returned');
        vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
          generateObject: vi.fn().mockRejectedValue(structuredError),
        } as any);

        const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

        await expect(
          caller.outputJSON({
            ...inputCompletionInput,
            schema: undefined,
            tools: [
              {
                function: { name: 'pick', parameters: { properties: {}, type: 'object' } },
                type: 'function',
              },
            ],
          }),
        ).rejects.toMatchObject({ cause: structuredError, code: 'INTERNAL_SERVER_ERROR' });
      });

      it('keeps mapping provider errors in schema mode', async () => {
        const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
        vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
          generateObject: vi.fn().mockRejectedValue({
            error: undefined,
            errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
          }),
        } as any);

        const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

        await expect(caller.outputJSON(inputCompletionInput)).rejects.toMatchObject({
          code: 'UNAUTHORIZED',
          message: AgentRuntimeErrorType.InvalidProviderAPIKey,
        });
      });
    });

    it('rejects a caller-supplied tracing.tracingId that is not a UUID', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
      const mockGenerateObject = vi.fn();
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        objectGenerationRuntime(mockGenerateObject) as any,
      );

      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

      await expect(
        caller.outputJSON({
          messages: [],
          model: 'gpt-4o-mini',
          provider: 'openai',
          tracing: { tracingId: 'not-a-uuid' },
        }),
      ).rejects.toThrow();

      expect(mockGenerateObject).not.toHaveBeenCalled();
    });

    it('honours caller-supplied tracing.tracingId instead of generating a new one', async () => {
      const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
      const mockGenerateObject = vi.fn().mockResolvedValue({ completion: 'ok' });
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue(
        objectGenerationRuntime(mockGenerateObject) as any,
      );

      const callerSuppliedId = '00000000-0000-4000-8000-000000000001';
      const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);
      const result = await caller.outputJSON({
        messages: [],
        model: 'gpt-4o-mini',
        provider: 'openai',
        tracing: { tracingId: callerSuppliedId },
      });

      expect(result.tracingId).toBe(callerSuppliedId);
      expect(mockGenerateObject.mock.calls[0][1].tracing.tracingId).toBe(callerSuppliedId);
    });
  });
});
