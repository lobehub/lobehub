import {
  type AgentState,
  type CallLLMPayload,
  selectEnableExpertise,
  selectExpertise,
} from '@lobechat/agent-runtime';
import { gatherContextFacts } from '@lobechat/mecha';
import type { ChatStreamPayload } from '@lobechat/model-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  buildContextEngineeringAttributes,
  CONTEXT_ENGINEERING_SPAN_NAME,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';

import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';
import {
  createServerContextFactProviders,
  resolveServerConnectorFeatures,
} from '@/server/modules/Mecha/ContextEngineering/providers';

import type { RuntimeExecutorContext } from '../context';
import {
  resolveServerCallLlmContextHints,
  type ServerCallLlmContextHints,
} from './serverCallLlmContextHints';
import type { ServerCallLlmTooling } from './serverCallLlmTooling';

interface BuildServerCallLlmContextInput {
  ctx: RuntimeExecutorContext;
  llmPayload: CallLLMPayload;
  model: string;
  provider: string;
  state: AgentState;
  tooling: ServerCallLlmTooling;
}

export interface ServerCallLlmContextBuildResult {
  preserveThinkingForPayload?: boolean;
  processedMessages: ChatStreamPayload['messages'];
  resolvedExtendParams?: ServerCallLlmContextHints['resolvedExtendParams'];
  shouldReplayAssistantReasoning: boolean;
  /** An explicit operation-level `stream` wins; otherwise the agent's chat config. */
  stream?: boolean;
}

export const buildServerCallLlmContext = async ({
  ctx,
  llmPayload,
  model,
  provider,
  state,
  tooling,
}: BuildServerCallLlmContextInput): Promise<ServerCallLlmContextBuildResult> => {
  const agentConfig = state.world?.agent;
  if (!agentConfig) {
    return {
      processedMessages: llmPayload.messages as ChatStreamPayload['messages'],
      shouldReplayAssistantReasoning: false,
    };
  }

  const { operationId, stepIndex } = ctx;
  const { resolved, resolvedSkills, toolDiscoveryConfig, activeDeviceId, executionTarget } =
    tooling;
  const contextHints = await resolveServerCallLlmContextHints({
    ctx,
    llmPayload,
    model,
    provider,
    world: state.world,
  });
  const {
    capabilities,
    enableAgentMode,
    historyCount,
    messagesForContext,
    modelDisplayName,
    modelKnowledgeCutoff,
    preserveThinkingForPayload,
    resolvedExtendParams,
    shouldReplayAssistantReasoning,
  } = contextHints;

  const agentId = state.origin?.agentId;
  const topicId = ctx.topicId ?? state.origin?.topicId;
  // Which facts this turn needs is decided by the shared rules; the server
  // only answers the lookups they ask for.
  const facts = await gatherContextFacts(
    {
      activeDeviceId,
      agent: {
        chatConfig: agentConfig.chatConfig,
        description: agentConfig.description,
        slug: agentConfig.slug,
        title: agentConfig.title,
      },
      agentId,
      disabledPluginIds: state.world?.disabledPluginIds,
      editingAgentId: state.metadata?.editingAgentId as string | undefined,
      editingGroupId: state.metadata?.editingGroupId as string | undefined,
      enabledToolIds: resolved.enabledToolIds,
      executionTarget,
      features: resolveServerConnectorFeatures(),
      mentionedAgents: (state as any).initialContext?.initialContext?.mentionedAgents,
      messages: messagesForContext,
      shareVisitor: state.principal?.actor?.shareVisitor ?? ctx.agentShareVisitor,
      topicId,
      workspaceId: state.origin?.workspaceId ?? ctx.workspaceId,
    },
    createServerContextFactProviders({ ctx, state }),
  );

  const contextEngineInput = {
    additionalContexts: llmPayload.additionalContexts,
    agentDocuments: facts.agentDocuments,
    // Identity lives on the agent row, not in the prompt text — inject it so
    // the model introduces itself by the user-given name.
    agentIdentity: { name: agentConfig.name ?? undefined, title: agentConfig.title ?? undefined },
    ...(facts.step.agentBuilderContext && { agentBuilderContext: facts.step.agentBuilderContext }),
    agentGroup: state.world?.group,
    agentManagementContext: facts.step.agentManagementContext,
    additionalVariables: {
      ...state.binding?.device?.systemInfo,
      ...facts.variables,
      // Only override the generator's 'en-US' locale fallback when the user info
      // fetch actually resolved a language — an empty string would render blank.
      ...(facts.variables.language && { locale: facts.variables.language as string }),
    },
    userTimezone: state.world?.userTimezone,
    capabilities,
    botPlatformContext: state.world?.channel?.botPlatform,
    ...(facts.step.workspaceContext && { workspaceContext: facts.step.workspaceContext }),
    discordContext: state.world?.channel?.discord,
    enableExpertise: selectEnableExpertise(state),
    enableHistoryCount: agentConfig.chatConfig?.enableHistoryCount ?? undefined,
    evalContext: state.world?.eval,
    expertise: selectExpertise(state),
    forceFinish: state.forceFinish,
    ...(facts.step.groupAgentBuilderContext && {
      groupAgentBuilderContext: facts.step.groupAgentBuilderContext,
    }),
    historyCount,
    initialContext: (state as any).initialContext?.initialContext,
    knowledge: {
      fileContents: agentConfig.files
        ?.filter((file: { enabled?: boolean | null }) => file.enabled === true)
        .map((file: { content?: string | null; id?: string; name?: string }) => ({
          content: file.content ?? '',
          fileId: file.id ?? '',
          filename: file.name ?? '',
        })),
      knowledgeBases: agentConfig.knowledgeBases
        ?.filter((knowledgeBase: { enabled?: boolean | null }) => knowledgeBase.enabled === true)
        .map((knowledgeBase: { id?: string; name?: string }) => ({
          id: knowledgeBase.id ?? '',
          name: knowledgeBase.name ?? '',
        })),
    },
    messages: messagesForContext,
    model,
    modelDisplayName,
    modelKnowledgeCutoff,
    provider,
    ...(facts.step.planTodo && { planTodo: facts.step.planTodo }),
    connectorOwnershipNote: state.world?.connectorOwnershipNote,
    projectInstructions: state.world?.projectInstructions,
    systemRole: agentConfig.systemRole ?? undefined,
    toolDiscoveryConfig,
    toolsConfig: {
      manifests: Object.values(resolved.promptManifestMap),
      tools: resolved.enabledToolIds,
    },
    userMemory: state.world?.userMemory,
    ...(resolvedSkills?.enabledSkills?.length && {
      skillsConfig: { enabledSkills: resolvedSkills.enabledSkills },
    }),
    enableAgentMode,
    ...(facts.step.topicReferences && { topicReferences: facts.step.topicReferences }),
    ...(facts.step.onboardingContext && { onboardingContext: facts.step.onboardingContext }),
  };

  const processedMessages = await agentRuntimeTracer.startActiveSpan(
    CONTEXT_ENGINEERING_SPAN_NAME,
    {
      attributes: buildContextEngineeringAttributes({
        hasImages: (messagesForContext as Array<{ content?: unknown }>).some(
          (message) =>
            Array.isArray(message.content) &&
            (message.content as Array<{ type?: string }>).some(
              (part) => part?.type === 'image_url',
            ),
        ),
        historyCompressed:
          Array.isArray(messagesForContext) &&
          messagesForContext.some(
            (message: { role?: string }) => message?.role === 'compressedGroup',
          ),
        knowledgeCount:
          (contextEngineInput.knowledge?.knowledgeBases?.length ?? 0) +
          (contextEngineInput.knowledge?.fileContents?.length ?? 0),
        knowledgeInjected:
          (contextEngineInput.knowledge?.knowledgeBases?.length ?? 0) > 0 ||
          (contextEngineInput.knowledge?.fileContents?.length ?? 0) > 0,
        memoryInjected: Boolean(contextEngineInput.userMemory?.memories),
        messageCount: messagesForContext.length,
        operationId,
        stepIndex,
        systemRoleLength: contextEngineInput.systemRole?.length,
        toolCount: contextEngineInput.toolsConfig?.tools?.length ?? 0,
      }),
    },
    async (ceSpan) => {
      try {
        const result = await serverMessagesEngine(contextEngineInput);
        ceSpan.setAttribute('lobehub.context.message_count', result.length);
        return result;
      } catch (error) {
        ceSpan.recordException(error as Error);
        ceSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        ceSpan.end();
      }
    },
  );

  const {
    messages: _inputMsgs,
    toolsConfig: _toolsConfig,
    ...contextEngineInputLite
  } = contextEngineInput;
  ctx.tracingContextEngine?.(
    { ...contextEngineInputLite, toolCount: _toolsConfig?.tools?.length ?? 0 },
    processedMessages,
  );

  return {
    preserveThinkingForPayload,
    processedMessages,
    resolvedExtendParams,
    shouldReplayAssistantReasoning,
    stream: ctx.stream ?? contextHints.stream,
  };
};
