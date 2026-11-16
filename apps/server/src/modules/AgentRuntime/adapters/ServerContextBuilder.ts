import type {
  ContextBuilder,
  ContextBuildInput,
  ContextBuildOutput,
} from '@lobechat/agent-runtime';
import { tryCountRequestPayloadTokens } from '@lobechat/context-engine';

import type { RuntimeExecutorContext } from '../context';
import { buildServerCallLlmContext } from './serverCallLlmContextBuilder';
import { resolveServerCallLlmTooling } from './serverCallLlmTooling';

export class ServerContextBuilder implements ContextBuilder {
  constructor(private readonly ctx: RuntimeExecutorContext) {}

  async build(input: ContextBuildInput): Promise<ContextBuildOutput> {
    const tooling = resolveServerCallLlmTooling(
      this.ctx,
      input.state,
      input.payload.allowedToolNames,
    );
    const result = await buildServerCallLlmContext({
      ctx: this.ctx,
      llmPayload: input.payload,
      model: input.model,
      provider: input.provider,
      state: input.state,
      tooling,
    });

    return {
      // The attempt ships these messages and `resolved.tools` as-is.
      contextAccounting: tryCountRequestPayloadTokens({
        messages: result.processedMessages,
        tools: tooling.resolved.tools,
      }),
      messages: result.processedMessages,
      modelParameters: {
        ...result.resolvedExtendParams,
        ...(typeof result.stream === 'boolean' && { stream: result.stream }),
      },
      preserveThinking: result.preserveThinkingForPayload,
      replayAssistantReasoning: result.shouldReplayAssistantReasoning,
      resolvedTools: tooling.resolved,
    };
  }
}
