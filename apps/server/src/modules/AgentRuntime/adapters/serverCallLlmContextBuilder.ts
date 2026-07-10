import type { AgentState, CallLLMPayload } from '@lobechat/agent-runtime';
import {
  type ComposioServiceSummary,
  type CredSummary,
  excludeDisabledComposioServices,
  generateComposioServicesList,
  generateCredsList,
  resolveAvailableComposioServices,
} from '@lobechat/builtin-tool-creds';
import { builtinTools } from '@lobechat/builtin-tools';
import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import type {
  AgentBuilderContext,
  AgentContextDocument,
  AgentGroupConfig,
  OfficialToolItem,
  OnboardingContext,
} from '@lobechat/context-engine';
import { resolveTopicReferences } from '@lobechat/context-engine';
import type { ChatStreamPayload } from '@lobechat/model-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  buildContextEngineeringAttributes,
  CONTEXT_ENGINEERING_SPAN_NAME,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import { getActivePluginIds, getDisabledPluginIds } from '@lobechat/types';

import { composioEnv } from '@/config/composio';
import { AgentModel } from '@/database/models/agent';
import { FileModel } from '@/database/models/file';
import { MessageModel as MessageModelClass } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { MarketService } from '@/server/services/market';
import { OnboardingService } from '@/server/services/onboarding';
import { toAgentContextDocuments } from '@/utils/agentDocumentContextMapping';

import type { RuntimeExecutorContext } from '../context';
import { buildPostProcessUrl, log, resolveRuntimeHistoryCount } from '../executorHelpers';
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
}

export const buildServerCallLlmContext = async ({
  ctx,
  llmPayload,
  model,
  provider,
  state,
  tooling,
}: BuildServerCallLlmContextInput): Promise<ServerCallLlmContextBuildResult> => {
  const agentConfig = ctx.agentConfig;
  if (!agentConfig) {
    return {
      processedMessages: llmPayload.messages as ChatStreamPayload['messages'],
      shouldReplayAssistantReasoning: false,
    };
  }

  const { operationId, stepIndex } = ctx;
  const { resolved, resolvedSkills, toolDiscoveryConfig } = tooling;
  const contextHints = await resolveServerCallLlmContextHints({
    ctx,
    llmPayload,
    model,
    provider,
  });
  const {
    capabilities,
    messagesForContext,
    modelDisplayName,
    modelKnowledgeCutoff,
    preserveThinkingForPayload,
    resolvedExtendParams,
    shouldReplayAssistantReasoning,
  } = contextHints;

  // Extract <refer_topic> tags from messages and fetch summaries.
  // Skip if messages already contain injected topic_reference_context
  // (e.g., from client-side contextEngineering preprocessing) to avoid double injection.
  let topicReferences;
  const alreadyHasTopicRefs = (messagesForContext as Array<{ content: string | unknown }>).some(
    (message) =>
      typeof message.content === 'string' && message.content.includes('topic_reference_context'),
  );

  if (!alreadyHasTopicRefs && ctx.serverDB && ctx.userId) {
    const topicModel = new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
    const messageModel = new MessageModelClass(ctx.serverDB, ctx.userId, ctx.workspaceId);
    topicReferences = await resolveTopicReferences(
      messagesForContext as Array<{ content: string | unknown }>,
      async (topicId) => topicModel.findById(topicId),
      async (topicId) => {
        const topic = await topicModel.findById(topicId);
        return messageModel.query(
          {
            agentId: topic?.agentId ?? undefined,
            groupId: topic?.groupId ?? undefined,
            topicId,
          },
          { postProcessUrl: buildPostProcessUrl(ctx) },
        );
      },
    );
  }

  // Fetch agent documents for context injection.
  let agentDocuments: AgentContextDocument[] | undefined;
  const agentId = state.metadata?.agentId;
  if (agentId && ctx.serverDB && ctx.userId) {
    try {
      const agentDocService = new AgentDocumentsService(
        ctx.serverDB,
        ctx.userId,
        state.metadata?.workspaceId ?? ctx.workspaceId,
      );
      const docs = await agentDocService.getAgentContextDocuments(agentId);
      if (docs.length > 0) {
        agentDocuments = toAgentContextDocuments(docs);
        log('Resolved %d agent documents for agent %s', agentDocuments.length, agentId);
      }
    } catch (error) {
      log('Failed to resolve agent documents for agent %s: %O', agentId, error);
    }
  }

  // Detect onboarding agent and build context injection.
  let onboardingContext: OnboardingContext | undefined;
  const isOnboardingAgent =
    agentConfig?.slug === 'web-onboarding' ||
    resolved.enabledToolIds.includes('lobe-web-onboarding');
  const alreadyHasOnboardingContext = (
    messagesForContext as Array<{ content: string | unknown }>
  ).some((message) => {
    if (typeof message.content !== 'string') return false;

    return (
      message.content.includes('<onboarding_context>') ||
      message.content.includes('<current_soul_document>') ||
      message.content.includes('<current_user_persona>')
    );
  });

  if (isOnboardingAgent && !alreadyHasOnboardingContext && ctx.serverDB && ctx.userId) {
    try {
      const { formatWebOnboardingStateMessage } =
        await import('@lobechat/builtin-tool-web-onboarding/utils');
      const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
      const docService = new AgentDocumentsService(
        ctx.serverDB,
        ctx.userId,
        state.metadata?.workspaceId ?? ctx.workspaceId,
      );
      const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);

      const [onboardingState, soulDoc, persona, userInfo] = await Promise.all([
        onboardingService.getState(),
        onboardingService
          .getInboxAgentId()
          .then((inboxAgentId) =>
            inboxAgentId ? docService.getDocumentByFilename(inboxAgentId, 'SOUL.md') : null,
          )
          .catch((error) => {
            log('Failed to fetch SOUL.md for onboarding context: %O', error);
            return null;
          }),
        personaModel.getLatestPersonaDocument().catch((error) => {
          log('Failed to fetch user persona for onboarding context: %O', error);
          return null;
        }),
        onboardingService.getInitialUserInfo().catch((error) => {
          log('Failed to fetch initial user info for onboarding context: %O', error);
          return undefined;
        }),
      ]);

      onboardingContext = {
        discoveryUserMessageCount: onboardingState.discoveryUserMessageCount,
        personaContent: persona?.persona ?? null,
        phaseGuidance: formatWebOnboardingStateMessage(onboardingState),
        remainingDiscoveryExchanges: onboardingState.remainingDiscoveryExchanges,
        soulContent: soulDoc?.content ?? null,
        userInfo,
      };
      log('Built onboarding context for agent %s, phase: %s', agentId, onboardingState.phase);
    } catch (error) {
      log('Failed to build onboarding context: %O', error);
    }
  }

  // Build additional placeholder variables for the lobehub builtin skill
  // (`packages/builtin-skills/src/lobehub/content.ts`) so it can render
  // `{{agent_id}}` / `{{agent_title}}` / `{{topic_id}}` etc. into the
  // model's prompt without needing a separate context injector.
  const lobehubSkillAgentId = state.metadata?.agentId;
  const lobehubSkillTopicId = state.metadata?.topicId;
  const lobehubSkillAgentMeta = state.metadata?.agentConfig as
    { description?: string | null; title?: string | null } | undefined;

  let lobehubSkillTopicTitle = '';
  if (lobehubSkillTopicId && ctx.serverDB && ctx.userId) {
    try {
      const topicModelForLobehub = new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const topicRecord = await topicModelForLobehub.findById(lobehubSkillTopicId);
      lobehubSkillTopicTitle = topicRecord?.title ?? '';
    } catch (error) {
      log('Failed to load topic title for lobehub skill placeholders: %O', error);
    }
  }

  const lobehubSkillVariables: Record<string, string> = {
    agent_description: lobehubSkillAgentMeta?.description ?? '',
    agent_id: lobehubSkillAgentId ?? '',
    agent_title: lobehubSkillAgentMeta?.title ?? '',
    topic_id: lobehubSkillTopicId ?? '',
    topic_title: lobehubSkillTopicTitle,
  };

  // Tool-specific template variable resolution. The client-side
  // contextEngineering.ts resolves these via Zustand stores and lambdaClient.
  // In execAgent (server/bot) mode we must fetch from DB directly.
  let serverUsername = '';
  let serverLanguage = '';
  if (ctx.serverDB && ctx.userId) {
    try {
      const userInfo = await UserModel.getInfoForAIGeneration(ctx.serverDB, ctx.userId);
      serverUsername = userInfo.userName;
      serverLanguage = userInfo.responseLanguage;
    } catch (error) {
      log('Failed to fetch user info for {{username}}/{{language}} substitution: %O', error);
    }
  }

  const sandboxEnabled = String(resolved.enabledToolIds.includes('lobe-cloud-sandbox'));
  let sandboxUploadedFiles = '';
  if (sandboxEnabled === 'true' && ctx.serverDB && ctx.userId && lobehubSkillTopicId) {
    try {
      const { formatUploadedFilesPrompt } = await import('@lobechat/builtin-tool-cloud-sandbox');
      const fileModel = new FileModel(ctx.serverDB, ctx.userId);
      const uploadedFiles = await fileModel.findFilesToInitInSandbox(lobehubSkillTopicId);
      sandboxUploadedFiles = formatUploadedFilesPrompt(uploadedFiles);
    } catch (error) {
      log('Failed to resolve files for {{sandbox_uploaded_files}} substitution: %O', error);
    }
  }

  const sessionDate = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: ctx.userTimezone || 'UTC',
    weekday: 'long',
    year: 'numeric',
  }).format(new Date());

  const memoryEffort = String(
    (state.metadata?.agentConfig as any)?.chatConfig?.memory?.effort ?? '',
  );

  let credsListStr = '';
  if (ctx.userId) {
    try {
      const marketService = new MarketService({ userInfo: { userId: ctx.userId } });
      // Inside a workspace, the agent must only see the workspace's shared
      // organization credentials — personal creds are not visible here (LOBE-10978).
      const credsResult = ctx.workspaceId
        ? await marketService.market.organizations.creds({ workspaceId: ctx.workspaceId }).list()
        : await marketService.market.creds.list();
      const userCreds = (credsResult as any)?.data ?? [];
      credsListStr = generateCredsList(
        userCreds.map((cred: any): CredSummary => ({
          description: cred.description,
          key: cred.key,
          name: cred.name,
          ownerDisplayName: cred.ownerDisplayName,
          ownerType: cred.ownerType,
          type: cred.type,
        })),
      );
      log('Fetched %d creds for {{CREDS_LIST}} substitution', userCreds.length);
    } catch (error) {
      log('Failed to fetch creds for {{CREDS_LIST}} substitution: %O', error);
    }
  }

  let composioServicesListStr = '';
  if (ctx.serverDB && ctx.userId && !!composioEnv.COMPOSIO_API_KEY) {
    try {
      const pluginModel = new PluginModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const allPlugins = await pluginModel.query();
      const validComposioIds = new Set(COMPOSIO_APP_TYPES.map((tool) => tool.identifier));
      const connectedIds = new Set(
        allPlugins
          .filter(
            (plugin) =>
              validComposioIds.has(plugin.identifier) &&
              (plugin.customParams as any)?.composio?.status === 'ACTIVE',
          )
          .map((plugin) => plugin.identifier),
      );
      // Disabled services are dropped from both lists — not surfaced as
      // "connected, use directly" nor as "available to connect".
      let disabledIdSet = new Set<string>();
      if (agentId) {
        const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
        const agentConfig = await agentModel.getAgentConfigById(agentId);
        disabledIdSet = new Set(getDisabledPluginIds(agentConfig?.plugins ?? undefined));
      }
      const connected: ComposioServiceSummary[] = excludeDisabledComposioServices(
        COMPOSIO_APP_TYPES.filter((tool) => connectedIds.has(tool.identifier)),
        disabledIdSet,
      ).map((tool) => ({ identifier: tool.identifier, name: tool.label }));
      const available = resolveAvailableComposioServices(
        COMPOSIO_APP_TYPES,
        connectedIds,
        disabledIdSet,
      );
      composioServicesListStr = generateComposioServicesList(connected, available);
      log(
        'Fetched Composio services for {{COMPOSIO_SERVICES_LIST}}: connected=%d, available=%d',
        connected.length,
        available.length,
      );
    } catch (error) {
      log(
        'Failed to fetch Composio services for {{COMPOSIO_SERVICES_LIST}} substitution: %O',
        error,
      );
    }
  }

  let agentBuilderContext: AgentBuilderContext | undefined;
  const editingAgentId = state.metadata?.editingAgentId;
  if (editingAgentId && ctx.serverDB && ctx.userId) {
    try {
      const editingAgentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const editingConfig = (await editingAgentModel.getAgentConfigById(editingAgentId)) as Record<
        string,
        any
      > | null;
      if (editingConfig) {
        const enabledPlugins: string[] = getActivePluginIds(
          Array.isArray(editingConfig.plugins) ? editingConfig.plugins : undefined,
        );
        const composioIdentifiers = new Set(COMPOSIO_APP_TYPES.map((tool) => tool.identifier));
        const officialTools: OfficialToolItem[] = [];

        for (const tool of builtinTools) {
          if (tool.hidden) continue;
          if (composioIdentifiers.has(tool.identifier)) continue;
          officialTools.push({
            description: tool.manifest?.meta?.description,
            enabled: enabledPlugins.includes(tool.identifier),
            identifier: tool.identifier,
            installed: true,
            name: tool.manifest?.meta?.title || tool.identifier,
            type: 'builtin',
          });
        }

        if (composioEnv.COMPOSIO_API_KEY) {
          try {
            const pluginModel = new PluginModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
            const allPlugins = await pluginModel.query();
            const connectedComposioIds = new Set(
              allPlugins
                .filter(
                  (plugin) =>
                    composioIdentifiers.has(plugin.identifier) &&
                    (plugin.customParams as any)?.composio?.status === 'ACTIVE',
                )
                .map((plugin) => plugin.identifier),
            );
            for (const tool of COMPOSIO_APP_TYPES) {
              officialTools.push({
                description: `LobeHub Mcp Server: ${tool.label}`,
                enabled: enabledPlugins.includes(tool.identifier),
                identifier: tool.identifier,
                installed: connectedComposioIds.has(tool.identifier),
                name: tool.label,
                type: 'composio',
              });
            }
          } catch (composioError) {
            log('Failed to load Composio status for agentBuilderContext: %O', composioError);
          }
        }

        agentBuilderContext = {
          config: {
            chatConfig: editingConfig.chatConfig ?? undefined,
            model: editingConfig.model ?? undefined,
            openingMessage: editingConfig.openingMessage ?? undefined,
            openingQuestions: editingConfig.openingQuestions ?? undefined,
            params: editingConfig.params ?? undefined,
            plugins: enabledPlugins,
            provider: editingConfig.provider ?? undefined,
            systemRole: editingConfig.systemRole ?? undefined,
          },
          meta: {
            avatar: editingConfig.avatar ?? undefined,
            backgroundColor: editingConfig.backgroundColor ?? undefined,
            description: editingConfig.description ?? undefined,
            tags: editingConfig.tags ?? undefined,
            title: editingConfig.title ?? undefined,
          },
          ...(officialTools.length > 0 && { officialTools }),
        };
      }
    } catch (error) {
      log('Failed to build agentBuilderContext for editing agent %s: %O', editingAgentId, error);
    }
  }

  const contextEngineInput = {
    agentDocuments,
    ...(agentBuilderContext && { agentBuilderContext }),
    agentGroup: state.metadata?.agentGroup as AgentGroupConfig | undefined,
    agentManagementContext: (state as any).initialContext?.initialContext?.mentionedAgents?.length
      ? {
          mentionedAgents: (state as any).initialContext.initialContext.mentionedAgents,
        }
      : undefined,
    additionalVariables: {
      ...state.metadata?.deviceSystemInfo,
      ...lobehubSkillVariables,
      COMPOSIO_SERVICES_LIST: composioServicesListStr,
      CREDS_LIST: credsListStr,
      language: serverLanguage,
      memory_effort: memoryEffort,
      sandbox_enabled: sandboxEnabled,
      sandbox_uploaded_files: sandboxUploadedFiles,
      session_date: sessionDate,
      username: serverUsername,
    },
    userTimezone: ctx.userTimezone,
    capabilities,
    botPlatformContext: ctx.botPlatformContext,
    discordContext: ctx.discordContext,
    enableHistoryCount: agentConfig.chatConfig?.enableHistoryCount ?? undefined,
    evalContext: ctx.evalContext,
    forceFinish: state.forceFinish,
    historyCount: resolveRuntimeHistoryCount(agentConfig.chatConfig?.historyCount),
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
    systemRole: agentConfig.systemRole ?? undefined,
    toolDiscoveryConfig,
    toolsConfig: {
      manifests: Object.values(resolved.promptManifestMap),
      tools: resolved.enabledToolIds,
    },
    userMemory: state.metadata?.userMemory,
    ...(resolvedSkills?.enabledSkills?.length && {
      skillsConfig: { enabledSkills: resolvedSkills.enabledSkills },
    }),
    enableAgentMode: agentConfig.chatConfig?.enableAgentMode,
    ...(topicReferences && { topicReferences }),
    ...(onboardingContext && { onboardingContext }),
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
  };
};
