import type {
  AgentRuntimeContext,
  ContextBuilder,
  ContextBuildInput,
  ContextBuildOutput,
} from '@lobechat/agent-runtime';
import {
  contextReplayMessageIds,
  ToolResolver,
  type ToolsEngine,
  tryCountRequestPayloadTokens,
  withContextReplays,
} from '@lobechat/context-engine';
import type { MessageMetadata } from '@lobechat/types';
import { TraceNameMap } from '@lobechat/types';
import { dedupeBy } from '@lobechat/utils';

import { chatService } from '@/services/chat';
import type { ResolvedAgentConfig } from '@/services/chat/mecha';
import type { FetchOptions } from '@/services/chat/types';
import { messageService } from '@/services/message';
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

    const resolvedAgentConfig = this.resolveAgentConfig(input);
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
      enabledManifests: Object.values(resolvedTools.promptManifestMap),
      enabledToolIds: resolvedTools.enabledToolIds,
      tools: resolvedTools.tools.length > 0 ? resolvedTools.tools : undefined,
    };
    const { agentId, groupId, subAgentId, topicId } = operation.context;
    const effectiveAgentId = groupId && subAgentId ? subAgentId : agentId;
    const assistantMessageId = (input.payload as { assistantMessageId?: string })
      .assistantMessageId;
    const messages = input.payload.messages.filter(
      (message) => !assistantMessageId || message.id !== assistantMessageId,
    );
    const documentAgentId =
      input.state.origin?.editingAgentId ??
      (resolvedAgentConfig.enabledToolIds?.includes('lobe-agent-builder')
        ? this.context.get().activeAgentId
        : effectiveAgentId) ??
      undefined;
    const snapshots = input.contextReplay
      ? await messageService.getContextReplays(
          [...contextReplayMessageIds(messages), input.contextReplay.invocationId],
          documentAgentId,
        )
      : {};
    const prepared = await chatService.buildAssistantMessageContext(
      {
        agentId: effectiveAgentId || undefined,
        additionalContexts: input.payload.additionalContexts,
        attachmentPreviewFileIds: input.payload.attachmentPreviewFileIds,
        discoveryExcludedToolIds: this.context.agentConfig.enabledToolIds ?? [],
        discoveryManifests:
          input.state.operationToolSet?.manifestMap ?? input.state.toolManifestMap,
        groupId,
        messages: input.contextReplay ? withContextReplays(messages, snapshots) : messages,
        ...(input.contextReplay && {
          contextReplay: {
            ...input.contextReplay,
            resetHistory: Object.values(snapshots).some((snapshot) => snapshot.invalidated),
            sourceIdsByProvider: {
              ProjectContextInjector: input.state.origin?.projectId
                ? [`project:${input.state.origin.projectId}`]
                : [],
              TaskManagerContextInjector:
                operation.context.viewedTask?.type === 'detail'
                  ? [`task:${operation.context.viewedTask.taskId}`]
                  : [],
            },
            validateSources: (ids) => messageService.revokedContextSources(ids, documentAgentId),
            runtimeContext: {
              environment: input.state.plan?.execution?.kind,
              deviceId: input.state.binding?.device?.id,
            },
            committedSnapshot: snapshots[input.contextReplay.invocationId],
          },
        }),
        model: input.model,
        provider: input.provider,
        resolvedAgentConfig: promptAgentConfig,
        topicId: topicId ?? undefined,
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
      ...(prepared.contextReplaySnapshot && {
        beforeDispatch: async () => {
          const revoked = await messageService.revokedContextSources(
            prepared.contextReplaySnapshot!.sourceIds,
            documentAgentId,
          );
          if (revoked.length) throw new Error('Context source access revoked before dispatch');
        },
      }),
      // The client transport sends these messages and `params.tools` as-is.
      contextAccounting: tryCountRequestPayloadTokens({
        messages: preparedMessages,
        tools: params.tools,
      }),
      messages: preparedMessages,
      contextReplaySnapshot: prepared.contextReplaySnapshot,
      modelParameters: {
        options: prepared.options,
        params: {
          ...params,
          // The client transport builds the request from these params alone,
          // so a forced or configured preserveThinking must ride here too.
          ...(typeof prepared.preserveThinking === 'boolean' && {
            preserveThinking: prepared.preserveThinking,
          }),
        },
      } satisfies ClientLLMModelParameters,
      preserveThinking: prepared.preserveThinking,
      replayAssistantReasoning: prepared.replayAssistantReasoning ?? false,
      resolvedTools,
    };
  }

  private resolveAgentConfig(input: ContextBuildInput): ResolvedAgentConfig {
    const activatedToolIds = [
      ...(this.context.runtimeContext?.stepContext?.activatedToolIds ?? []),
      ...(input.state.activatedStepTools?.map((tool) => tool.id) ?? []),
    ];
    const uniqueActivatedToolIds = [...new Set(activatedToolIds)];

    if (!uniqueActivatedToolIds.length || !this.context.toolsEngine) {
      return this.context.agentConfig;
    }

    const additional = this.context.toolsEngine.generateToolsDetailed({
      context: { isExplicitActivation: true },
      model: input.model,
      provider: input.provider,
      skipDefaultTools: true,
      toolIds: uniqueActivatedToolIds,
    });

    if (!additional.tools?.length) return this.context.agentConfig;

    // A tool the run deferred starts with a narrowed manifest; once activated,
    // the engine's full one takes its place instead of losing to it below.
    const deferredManifestMap = input.state.operationToolSet?.deferredManifestMap ?? {};
    const promotedManifests = new Map(
      additional.enabledManifests
        .filter((manifest) => deferredManifestMap[manifest.identifier])
        .map((manifest) => [manifest.identifier, manifest]),
    );

    return {
      ...this.context.agentConfig,
      enabledManifests: dedupeBy(
        [
          ...(this.context.agentConfig.enabledManifests ?? []).map(
            (manifest) => promotedManifests.get(manifest.identifier) ?? manifest,
          ),
          ...additional.enabledManifests,
        ],
        (manifest) => manifest.identifier,
      ),
      enabledToolIds: [
        ...new Set([
          ...(this.context.agentConfig.enabledToolIds ?? []),
          ...additional.enabledToolIds,
        ]),
      ],
      tools: dedupeBy(
        [...(this.context.agentConfig.tools ?? []), ...additional.tools],
        (tool) => tool.function.name,
      ),
    };
  }
}
