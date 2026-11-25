import type {
  ContextBuilder,
  ContextBuildInput,
  ContextBuildOutput,
} from '@lobechat/agent-runtime';
import { tryCountRequestPayloadTokens } from '@lobechat/context-engine';

import { revokedContextSources } from '@/server/services/contextReplay';

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
      contextReplay: input.contextReplay,
      llmPayload: input.payload,
      model: input.model,
      provider: input.provider,
      state: input.state,
      tooling,
    });

    return {
      ...(result.contextReplaySnapshot && {
        beforeDispatch: async () => {
          const revoked = await revokedContextSources(
            {
              db: this.ctx.serverDB,
              userId: this.ctx.userId!,
              workspaceId: this.ctx.workspaceId,
              agentId: input.state.origin?.editingAgentId ?? input.state.origin?.agentId,
              shareVisitor:
                input.state.principal?.actor?.shareVisitor ?? this.ctx.agentShareVisitor,
              topicId: this.ctx.topicId ?? input.state.origin?.topicId,
            },
            result.contextReplaySnapshot!.sourceIds,
          );
          if (revoked.length) throw new Error('Context source access revoked before dispatch');
        },
      }),
      // The attempt ships these messages and `resolved.tools` as-is.
      contextAccounting: tryCountRequestPayloadTokens({
        messages: result.processedMessages,
        tools: tooling.resolved.tools,
      }),
      messages: result.processedMessages,
      contextReplaySnapshot: result.contextReplaySnapshot,
      getToolActivationContext: result.getToolActivationContext,
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
