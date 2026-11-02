import type {
  AgentRuntimeContext,
  ContextBuilder,
  ContextBuildInput,
  ContextBuildOutput,
} from '@lobechat/agent-runtime';
import { ToolResolver, type ToolsEngine } from '@lobechat/context-engine';
import { buildOnDemandBootstrapToolSet } from '@lobechat/context-engine/onDemand';
import { type MessageMetadata, resolveContextMode, TraceNameMap } from '@lobechat/types';
import { dedupeBy } from '@lobechat/utils';

import { isCanUseFC } from '@/helpers/isCanUseFC';
import { chatService } from '@/services/chat';
import type { ResolvedAgentConfig } from '@/services/chat/mecha';
import type { FetchOptions } from '@/services/chat/types';
import type { ChatStore } from '@/store/chat/store';
import type { ChatStreamPayload } from '@/types/openai/chat';

export interface ClientLLMModelParameters {
  options: FetchOptions;
  params: Omit<Partial<ChatStreamPayload>, 'messages'>;
}

interface ClientContextBuilderOptions {
  agentConfig: ResolvedAgentConfig;
  get: () => ChatStore;
  metadata?: Pick<MessageMetadata, 'trigger'>;
  operationId: string;
  runtimeContext?: AgentRuntimeContext;
  toolsEngine?: ToolsEngine;
}

export class ClientContextBuilder implements ContextBuilder {
  constructor(private readonly context: ClientContextBuilderOptions) {}

  async build(input: ContextBuildInput): Promise<ContextBuildOutput> {
    const operation = this.context.get().operations[this.context.operationId];
    if (!operation) throw new Error(`Operation not found: ${this.context.operationId}`);

    const onDemand = this.isOnDemand(input);
    const resolvedAgentConfig = this.resolveAgentConfig(input, onDemand);
    const manifestMap = Object.fromEntries(
      (resolvedAgentConfig.enabledManifests ?? []).map((manifest) => [
        manifest.identifier,
        manifest,
      ]),
    );
    const operationToolSet = {
      enabledToolIds: resolvedAgentConfig.enabledToolIds ?? [],
      executorMap: input.state.operationToolSet?.executorMap,
      manifestMap,
      sourceMap: input.state.operationToolSet?.sourceMap ?? {},
      tools: resolvedAgentConfig.tools ?? [],
    };
    const resolvedTools = new ToolResolver().resolve(
      operationToolSet,
      {
        activatedTools: [],
        ...(input.state.forceFinish && { deactivatedToolIds: ['*'] }),
      },
      [],
      input.payload.allowedToolNames,
    );
    const promptAgentConfig: ResolvedAgentConfig = {
      ...resolvedAgentConfig,
      // On-demand keeps every manifest as a discovery card, while only the
      // bootstrap and atomically activated identifiers become native tools.
      enabledManifests: onDemand
        ? resolvedAgentConfig.enabledManifests
        : Object.values(resolvedTools.promptManifestMap),
      enabledToolIds: resolvedTools.enabledToolIds,
      tools: resolvedTools.tools.length > 0 ? resolvedTools.tools : undefined,
    };
    const { agentConfig } = promptAgentConfig;
    const { agentId, groupId, subAgentId, topicId } = operation.context;
    const effectiveAgentId = groupId && subAgentId ? subAgentId : agentId;
    const assistantMessageId = (input.payload as { assistantMessageId?: string })
      .assistantMessageId;
    const messages = input.payload.messages.filter(
      (message) => !assistantMessageId || message.id !== assistantMessageId,
    );
    const prepared = await chatService.buildAssistantMessageContext(
      {
        agentId: effectiveAgentId || undefined,
        additionalContexts: input.payload.additionalContexts,
        groupId,
        messages,
        model: input.model,
        provider: input.provider,
        resolvedAgentConfig: promptAgentConfig,
        topicId: topicId ?? undefined,
        ...agentConfig.params,
      },
      {
        initialContext: this.context.runtimeContext?.initialContext,
        metadata: this.context.metadata,
        stepContext: this.context.runtimeContext?.stepContext,
        trace: chatService.mapChatTrace({
          traceId: operation.metadata?.traceId,
          topicId: topicId ?? undefined,
          traceName: TraceNameMap.Conversation,
        }),
      },
    );
    const { messages: preparedMessages = [], ...params } = prepared.params;

    return {
      messages: preparedMessages,
      modelParameters: {
        options: prepared.options,
        params,
      } satisfies ClientLLMModelParameters,
      preserveThinking:
        typeof prepared.params.preserveThinking === 'boolean'
          ? prepared.params.preserveThinking
          : undefined,
      replayAssistantReasoning: true,
      resolvedTools,
    };
  }

  private isOnDemand(input: ContextBuildInput): boolean {
    return (
      resolveContextMode(this.context.agentConfig.chatConfig, {
        supportToolUse: isCanUseFC(input.model, input.provider),
      }) === 'on-demand'
    );
  }

  private resolveAgentConfig(input: ContextBuildInput, onDemand: boolean): ResolvedAgentConfig {
    const bootstrap = onDemand ? buildOnDemandBootstrapToolSet() : undefined;
    const baseConfig: ResolvedAgentConfig = bootstrap
      ? {
          ...this.context.agentConfig,
          enabledToolIds: bootstrap.enabledToolIds,
          tools: bootstrap.tools,
        }
      : this.context.agentConfig;
    const activatedToolIds = [
      ...(this.context.runtimeContext?.stepContext?.activatedToolIds ?? []),
      ...(input.state.activatedStepTools?.map((tool) => tool.id) ?? []),
    ].filter((identifier) => !baseConfig.enabledToolIds?.includes(identifier));
    const uniqueActivatedToolIds = [...new Set(activatedToolIds)];

    if (!uniqueActivatedToolIds.length || !this.context.toolsEngine) {
      return baseConfig;
    }

    const additional = this.context.toolsEngine.generateToolsDetailed({
      context: { isExplicitActivation: true },
      model: input.model,
      provider: input.provider,
      skipDefaultTools: true,
      toolIds: uniqueActivatedToolIds,
    });

    if (!additional.tools?.length) return baseConfig;

    return {
      ...baseConfig,
      enabledManifests: dedupeBy(
        [...(baseConfig.enabledManifests ?? []), ...additional.enabledManifests],
        (manifest) => manifest.identifier,
      ),
      enabledToolIds: [
        ...new Set([...(baseConfig.enabledToolIds ?? []), ...additional.enabledToolIds]),
      ],
      tools: dedupeBy(
        [...(baseConfig.tools ?? []), ...additional.tools],
        (tool) => tool.function.name,
      ),
    };
  }
}
