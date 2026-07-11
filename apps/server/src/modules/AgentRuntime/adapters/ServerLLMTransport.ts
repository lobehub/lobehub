import type {
  BlobStore,
  LLMAttemptExecution,
  LLMAttemptInput,
  LLMStreamPayload,
  LLMStreamResult,
  LLMTransport,
  LLMTurnInput,
} from '@lobechat/agent-runtime';
import {
  type ChatStreamPayload,
  consumeStreamUntilDone,
  type ModelRuntime,
} from '@lobechat/model-runtime';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import type { RuntimeExecutorContext } from '../context';
import { createServerCallLlmAttempt } from './serverCallLlmAttempt';
import { executeServerCallLlmTurn } from './serverCallLlmExecutor';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return JSON.stringify(error);
};

/**
 * Server {@link LLMTransport} adapter — wraps model-runtime streaming and
 * returns the aggregated content/usage that package executors need.
 */
export class ServerLLMTransport implements LLMTransport {
  constructor(
    private readonly ctx: RuntimeExecutorContext,
    private readonly blobStore?: BlobStore,
  ) {}

  executeTurn(input: LLMTurnInput): ReturnType<NonNullable<LLMTransport['executeTurn']>> {
    let modelRuntimePromise: ReturnType<ServerLLMTransport['createModelRuntime']> | undefined;

    return executeServerCallLlmTurn(this.ctx, {
      assistantMessage: input.assistantMessage,
      context: input.context,
      model: input.model,
      provider: input.provider,
      runAttempt: async (attemptInput) => {
        modelRuntimePromise ??= this.createModelRuntime(input.provider);
        return this.runAttemptWithRuntime(attemptInput, await modelRuntimePromise);
      },
      state: input.state,
      stepLabel: input.stepLabel,
    });
  }

  async runAttempt(input: LLMAttemptInput): Promise<LLMAttemptExecution> {
    const modelRuntime = await this.createModelRuntime(input.provider);
    return this.runAttemptWithRuntime(input, modelRuntime);
  }

  async stream(
    payload: LLMStreamPayload,
    handlers?: Parameters<LLMTransport['stream']>[1],
  ): Promise<LLMStreamResult> {
    const runtime = await this.createModelRuntime(payload.provider);
    const { provider: _provider, ...runtimePayload } = payload;
    let content = '';
    let usage: LLMStreamResult['usage'];
    let streamError: unknown;

    const response = await runtime.chat(runtimePayload as any, {
      callback: {
        onCompletion: async (data: any) => {
          if (data.usage) usage = data.usage;
        },
        onError: async (errorData: unknown) => {
          streamError = errorData;
          handlers?.onError?.(errorData);
        },
        onText: async (text: string) => {
          content += text;
          handlers?.onText?.(text);
        },
      },
      user: this.ctx.userId,
    });

    await consumeStreamUntilDone(response);

    if (streamError) {
      throw new Error(getErrorMessage(streamError));
    }

    const result = { content, usage };
    handlers?.onFinish?.(result);
    return result;
  }

  private createModelRuntime(provider: string) {
    return initModelRuntimeFromDB(
      this.ctx.serverDB,
      this.ctx.userId!,
      provider,
      this.ctx.workspaceId,
    );
  }

  private async runAttemptWithRuntime(
    input: LLMAttemptInput,
    modelRuntime: Pick<ModelRuntime, 'chat'>,
  ): Promise<LLMAttemptExecution> {
    const resolved = input.context.resolvedTools;
    if (!resolved) throw new Error('Resolved tools are required for a server LLM attempt');

    const tools = resolved.tools.length > 0 ? resolved.tools : undefined;
    const chatPayload = {
      messages: input.context.messages as ChatStreamPayload['messages'],
      model: input.model,
      stream: this.ctx.stream ?? true,
      tools,
      ...(input.context.modelParameters as Partial<ChatStreamPayload>),
      ...(typeof input.context.preserveThinking === 'boolean' && {
        preserveThinking: input.context.preserveThinking,
      }),
    };
    const operationLogId = `${this.ctx.operationId}:${this.ctx.stepIndex}`;
    const attempt = createServerCallLlmAttempt({
      attempt: input.attempt,
      blobStore: this.blobStore,
      chatPayload,
      ctx: this.ctx,
      events: input.events,
      maxAttempts: input.maxAttempts,
      messageCount: chatPayload.messages.length,
      model: input.model,
      modelRuntime,
      onFirstChunk: input.onFirstChunk ?? (() => {}),
      operationLogId,
      provider: input.provider,
      resolved,
      topicId: input.state.metadata?.topicId,
      trigger: input.state.metadata?.trigger,
    });

    try {
      await attempt.execute();
      return { ok: true, output: attempt.snapshot() };
    } catch (error) {
      attempt.clearBuffers();
      return { error, ok: false, output: attempt.snapshot() };
    }
  }
}
