// @vitest-environment node
import type { LLMAttemptInput } from '@lobechat/agent-runtime';
import { ToolNameResolver } from '@lobechat/context-engine';
import type { ChatMethodOptions } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import type { RuntimeExecutorContext } from '../context';
import {
  createClientLlmExecutorLostError,
  createClientLlmExecutorUnavailableError,
  createClientLlmTimeoutError,
} from '../llmRelay/errors';
import { RelayModelRuntime } from '../llmRelay/RelayModelRuntime';
import { resolveLlmExecutionSite } from '../llmRelay/resolveLlmExecutionSite';
import { ServerLLMTransport } from './ServerLLMTransport';

const relay = vi.hoisted(() => ({
  chat: vi.fn(),
  usageEstimated: false,
}));

vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));
vi.mock('../llmRelay/resolveLlmExecutionSite', () => ({ resolveLlmExecutionSite: vi.fn() }));
vi.mock('../llmRelay/RelayModelRuntime', () => ({
  RelayModelRuntime: vi.fn(function (this: any) {
    this.chat = relay.chat;
    this.handleChatStreamError = vi.fn();
    this.result = {
      get usageEstimated() {
        return relay.usageEstimated;
      },
    };
  }),
}));
vi.mock('../redis', () => ({ getAgentRuntimeRedisClient: () => ({}) }));
vi.mock('@/business/server/recordModelCompletionFailure', () => ({
  recordModelCompletionFailure: vi.fn(),
}));
vi.mock('@/envs/file', () => ({ fileEnv: { NEXT_PUBLIC_S3_FILE_PATH: 'files' } }));

const toolName = new ToolNameResolver().generate('workspace', 'search', 'builtin');

const createCtx = () => {
  const publishStreamChunk = vi.fn().mockResolvedValue('chunk-id');
  const update = vi.fn().mockResolvedValue({ success: true });
  const ctx = {
    messageModel: { update } as unknown as RuntimeExecutorContext['messageModel'],
    operationId: 'op-1',
    serverDB: {} as RuntimeExecutorContext['serverDB'],
    stepIndex: 2,
    streamManager: {
      publishStreamChunk,
      publishStreamEvent: vi.fn().mockResolvedValue('event-id'),
    } as unknown as RuntimeExecutorContext['streamManager'],
    toolExecutionService: {} as RuntimeExecutorContext['toolExecutionService'],
    userId: 'user-1',
  } satisfies RuntimeExecutorContext;
  return { ctx, publishStreamChunk, update };
};

const createInput = (attempt = 1): LLMAttemptInput => ({
  assistantMessageId: 'msg-1',
  attempt,
  context: {
    messages: [{ content: 'Question', role: 'user' }],
    modelParameters: {},
    replayAssistantReasoning: false,
    resolvedTools: {
      enabledToolIds: [],
      executorMap: {},
      manifestMap: {},
      promptManifestMap: {},
      sourceMap: {},
      tools: [
        {
          function: { description: 'Search', name: toolName, parameters: { type: 'object' } },
          type: 'function',
        },
      ],
    },
  } as unknown as LLMAttemptInput['context'],
  events: [],
  maxAttempts: 6,
  model: 'llama3',
  provider: 'ollama',
  state: {} as LLMAttemptInput['state'],
});

const answerWith =
  (text: string, error?: unknown) => async (_payload: unknown, options: ChatMethodOptions) => {
    await options.callback?.onText?.(text);
    if (error) throw error;
    await options.callback?.onCompletion?.({
      text,
      usage: { totalInputTokens: 3, totalOutputTokens: 1, totalTokens: 4 },
    });
    return new Response('');
  };

/** `{operationId}:{stepIndex}:{generation}:{attempt}` for op-1, step 2, attempt 1. */
const CALL_ID_1 = /^op-1:2:[\w-]+:1$/;

describe('ServerLLMTransport · LLM relay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    relay.usageEstimated = false;
    vi.mocked(resolveLlmExecutionSite).mockResolvedValue({
      preferredClientId: 'tab-a',
      runtimeProvider: 'ollama',
      site: 'client',
    });
  });

  it('runs a client-site attempt through RelayModelRuntime and marks the output as client-executed', async () => {
    const { ctx, publishStreamChunk } = createCtx();
    relay.chat.mockImplementation(answerWith('Hi from my laptop'));
    relay.usageEstimated = true;

    const execution = await new ServerLLMTransport(ctx).runAttempt(createInput());

    expect(execution.ok).toBe(true);
    expect(execution.output).toMatchObject({
      content: 'Hi from my laptop',
      executionSite: 'client',
      usageEstimated: true,
    });
    expect(initModelRuntimeFromDB).not.toHaveBeenCalled();
    expect(RelayModelRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessageId: 'msg-1',
        attempt: 1,
        callId: expect.stringMatching(CALL_ID_1),
        operationId: 'op-1',
        preferredClientId: 'tab-a',
        provider: 'ollama',
        runtimeProvider: 'ollama',
        stepIndex: 2,
        userId: 'user-1',
      }),
    );
    // Re-published chunks carry the call id so the executor skips its own echo.
    expect(publishStreamChunk).toHaveBeenCalledWith(
      'op-1',
      2,
      expect.objectContaining({ chunkType: 'text', relayCallId: expect.stringMatching(CALL_ID_1) }),
    );
  });

  it('gives every attempt its own call id', async () => {
    const { ctx } = createCtx();
    relay.chat.mockImplementation(answerWith('ok'));
    const transport = new ServerLLMTransport(ctx);

    await transport.runAttempt(createInput(1));
    await transport.runAttempt(createInput(2));

    const [first, second] = vi.mocked(RelayModelRuntime).mock.calls.map(([p]) => p.callId);
    expect(first).toMatch(CALL_ID_1);
    expect(second).toMatch(/^op-1:2:[\w-]+:2$/);
    expect(first.split(':')[2]).toBe(second.split(':')[2]);
  });

  it('keeps a redriven step off the call ids of the execution it replaces', async () => {
    const { ctx } = createCtx();
    relay.chat.mockImplementation(answerWith('ok'));

    // The queue redrives the same operation/step after the first worker died.
    await new ServerLLMTransport(ctx).runAttempt(createInput(1));
    await new ServerLLMTransport(ctx).runAttempt(createInput(1));

    const [dead, redriven] = vi.mocked(RelayModelRuntime).mock.calls.map(([p]) => p.callId);
    expect(dead).toMatch(CALL_ID_1);
    expect(redriven).toMatch(CALL_ID_1);
    expect(redriven).not.toBe(dead);
  });

  it('fails fast with ClientLlmExecutorUnavailable when no client can execute the provider', async () => {
    const { ctx } = createCtx();
    vi.mocked(resolveLlmExecutionSite).mockResolvedValue({
      reason: 'no_executor',
      site: 'unavailable',
    });

    await expect(new ServerLLMTransport(ctx).runAttempt(createInput())).rejects.toMatchObject({
      error: { reason: 'no_executor', recoverable: true },
      errorType: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
      provider: 'ollama',
    });
    expect(relay.chat).not.toHaveBeenCalled();
    expect(initModelRuntimeFromDB).not.toHaveBeenCalled();
  });

  it('keeps the server path untouched for server-site providers', async () => {
    const { ctx } = createCtx();
    vi.mocked(resolveLlmExecutionSite).mockResolvedValue({ site: 'server' });
    const chat = vi.fn(answerWith('from the server'));
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
      chat,
      handleChatStreamError: vi.fn(),
    } as any);

    const execution = await new ServerLLMTransport(ctx).runAttempt(createInput());

    expect(execution.output.content).toBe('from the server');
    expect(execution.output.executionSite).toBeUndefined();
    expect(RelayModelRuntime).not.toHaveBeenCalled();
  });

  it('re-dispatches a lost executor twice and a missed first chunk once, never a missed total or no executor', () => {
    const { ctx } = createCtx();
    const { retryPolicy } = new ServerLLMTransport(ctx);
    const budget = (error: unknown) => retryPolicy.resolveRetryBudget('ollama', error);

    expect(budget(createClientLlmExecutorLostError('ollama', 'idle'))).toBe(2);
    expect(budget(createClientLlmTimeoutError('ollama', 'first_chunk'))).toBe(1);
    expect(budget(createClientLlmTimeoutError('ollama', 'total'))).toBe(0);
    expect(budget(createClientLlmExecutorUnavailableError('ollama', 'claim_timeout'))).toBe(0);
    expect(retryPolicy.classifyError(createClientLlmExecutorLostError('ollama', 'idle')).kind).toBe(
      'retry',
    );
    expect(
      retryPolicy.classifyError(createClientLlmExecutorUnavailableError('ollama', 'no_executor'))
        .kind,
    ).toBe('stop');
  });

  it('keeps the partial output, marked as cut short, when a relay failure is final', async () => {
    const { ctx, update } = createCtx();
    relay.chat.mockImplementation(
      answerWith('Half an answer', createClientLlmTimeoutError('ollama', 'total')),
    );

    const execution = await new ServerLLMTransport(ctx).runAttempt(createInput());

    expect(execution.ok).toBe(false);
    expect(update).toHaveBeenCalledWith('msg-1', {
      content: 'Half an answer',
      metadata: { executionSite: 'client', interruptedMidStream: true },
    });
  });

  it('drops the partial output while a lost executor still has re-dispatches left, keeps it after the last', async () => {
    const { ctx, update } = createCtx();
    relay.chat.mockImplementation(
      answerWith('Half', createClientLlmExecutorLostError('ollama', 'idle')),
    );
    const transport = new ServerLLMTransport(ctx);

    await transport.runAttempt(createInput(1));
    await transport.runAttempt(createInput(2));
    expect(update).not.toHaveBeenCalled();

    await transport.runAttempt(createInput(3));
    expect(update).toHaveBeenCalledWith('msg-1', expect.objectContaining({ content: 'Half' }));
  });

  it('keeps the partial of an earlier attempt when the re-dispatch finds no executor', async () => {
    const { ctx, update } = createCtx();
    relay.chat
      .mockImplementationOnce(
        answerWith('Half', createClientLlmExecutorLostError('ollama', 'idle')),
      )
      .mockImplementationOnce(async () => {
        // The tab that ran attempt 1 is gone: nobody claims the re-dispatch.
        throw createClientLlmExecutorUnavailableError('ollama', 'claim_timeout');
      });
    const transport = new ServerLLMTransport(ctx);

    await transport.runAttempt(createInput(1));
    expect(update).not.toHaveBeenCalled();

    const execution = await transport.runAttempt(createInput(2));
    expect(execution.ok).toBe(false);
    expect(update).toHaveBeenCalledWith('msg-1', {
      content: 'Half',
      metadata: { executionSite: 'client', interruptedMidStream: true },
    });
  });
});
