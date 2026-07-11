import type {
  LLMCallExecuteInput,
  LLMStreamPayload,
  LLMStreamResult,
  LLMTransport,
} from '@lobechat/agent-runtime';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';

import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import type { RuntimeExecutorContext } from '../context';
import { callLlm as createServerCallLlmExecutor } from './serverCallLlmExecutor';
import { resolveServerCallLlmTooling } from './serverCallLlmTooling';

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
  constructor(private readonly ctx: RuntimeExecutorContext) {}

  executeCall(input: LLMCallExecuteInput): ReturnType<NonNullable<LLMTransport['executeCall']>> {
    return createServerCallLlmExecutor(this.ctx, {
      assistantMessage: input.assistantMessage,
      model: input.model,
      provider: input.provider,
      stepLabel: input.stepLabel,
      tooling: resolveServerCallLlmTooling(
        this.ctx,
        input.state,
        input.instruction.payload.allowedToolNames,
      ),
    })(input.instruction, input.state);
  }

  async stream(
    payload: LLMStreamPayload,
    handlers?: Parameters<LLMTransport['stream']>[1],
  ): Promise<LLMStreamResult> {
    const runtime = await initModelRuntimeFromDB(
      this.ctx.serverDB,
      this.ctx.userId!,
      payload.provider,
      this.ctx.workspaceId,
    );
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
}
