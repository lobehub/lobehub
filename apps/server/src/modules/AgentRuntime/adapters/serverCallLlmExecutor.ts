import {
  type AgentEvent,
  type AgentInstruction,
  type CallLLMPayload,
  type GeneralAgentCallLLMResultPayload,
  getLLMRetryDelayMs,
  type InstructionExecutor,
  resolveLLMMaxAttempts,
  resolveLLMRetryBudget,
  shouldRetryLLM,
  stripAssistantReasoningForReplay,
  UsageCounter,
} from '@lobechat/agent-runtime';
import {
  type ComposioServiceSummary,
  type CredSummary,
  excludeDisabledComposioServices,
  generateComposioServicesList,
  generateCredsList,
  resolveAvailableComposioServices,
} from '@lobechat/builtin-tool-creds';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { builtinTools } from '@lobechat/builtin-tools';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import {
  type AgentBuilderContext,
  type AgentContextDocument,
  type AgentGroupConfig,
  buildStepSkillDelta,
  buildStepToolDelta,
  type LobeToolManifest,
  type OfficialToolItem,
  type OnboardingContext,
  type OperationToolSet,
  type ResolvedToolSet,
  resolveTopicReferences,
  SkillResolver,
  ToolNameResolver,
  ToolResolver,
} from '@lobechat/context-engine';
import {
  applyModelExtendParams,
  type ChatStreamPayload,
  consumeStreamUntilDone,
  isDeepSeekThinkingEligibleModel,
  isDeepSeekV4FamilyModel,
  isEmptyModelCompletion,
  isKimiAlwaysPreserveThinkingModel,
  ModelEmptyError,
  type ModelExtendParams,
} from '@lobechat/model-runtime';
import {
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace as otelTrace,
} from '@lobechat/observability-otel/api';
import {
  buildChatRequestAttributes,
  buildChatResponseAttributes,
  buildContextEngineeringAttributes,
  chatSpanName,
  CONTEXT_ENGINEERING_SPAN_NAME,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import {
  type ChatToolPayload,
  getActivePluginIds,
  getDisabledPluginIds,
  type MessageToolCall,
  type UIChatMessage,
} from '@lobechat/types';
import { sanitizeToolCallArguments, serializePartsForStorage } from '@lobechat/utils';
import { type ExtendParamsType, ModelProvider } from 'model-bank';

import { composioEnv } from '@/config/composio';
import { AgentModel } from '@/database/models/agent';
import { AiModelModel } from '@/database/models/aiModel';
import { FileModel } from '@/database/models/file';
import { MessageModel as MessageModelClass } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { fileEnv } from '@/envs/file';
import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { OnboardingService } from '@/server/services/onboarding';
import { toAgentContextDocuments } from '@/utils/agentDocumentContextMapping';
import { nanoid } from '@/utils/uuid';

import { type RuntimeExecutorContext } from '../context';
import {
  buildPostProcessUrl,
  buildToolDiscoveryConfig,
  isOperationInterrupted,
  log,
  resolveRuntimeHistoryCount,
  sleep,
  timing,
} from '../executorHelpers';
import { resolveRunActiveDeviceId } from '../executors/resolveRunActiveDeviceId';
import { formatErrorEventData } from '../formatErrorEventData';
import { classifyLLMError } from '../llmErrorClassification';
import { createConversationParentMissingError } from '../messagePersistErrors';
import { VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY } from '../visibleOutputEnd';

interface PreparedCallLLMContext {
  assistantMessage: { id: string };
  model: string;
  parentId?: string;
  provider: string;
  stepLabel?: string;
}

const SERVER_LLM_RETRY_POLICY = {
  isEmptyCompletionError: (error: unknown) => error instanceof ModelEmptyError,
  noRetryProviders: [BRANDING_PROVIDER],
};

export const callLlm =
  (ctx: RuntimeExecutorContext, prepared?: PreparedCallLLMContext): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_llm' }>;
    const llmPayload = payload as CallLLMPayload;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];
    let visibleOutputEndPublishedStepIndex: number | undefined;

    // Fallback to state's modelRuntimeConfig if not in payload
    const model = prepared?.model ?? llmPayload.model ?? state.modelRuntimeConfig?.model;
    const provider =
      prepared?.provider ?? llmPayload.provider ?? state.modelRuntimeConfig?.provider;
    // Resolve tools via ToolResolver (unified tool injection).
    //
    // Single-track device gate: `buildStepToolDelta` treats activeDeviceId as
    // an independent activation signal (it only dedupes against already-
    // enabled tools), so any id that reaches it WILL inject local-system.
    // `resolveRunActiveDeviceId` swallows the id whenever the plan/policy
    // forbids devices — the same filter the tool executors apply.
    const activeDeviceId = resolveRunActiveDeviceId(state.metadata);
    const operationToolSet: OperationToolSet = state.operationToolSet ?? {
      enabledToolIds: [],
      executorMap: state.toolExecutorMap ?? {},
      manifestMap: state.toolManifestMap ?? {},
      sourceMap: state.toolSourceMap ?? {},
      tools: state.tools ?? [],
    };

    const stepDelta = buildStepToolDelta({
      activeDeviceId,
      enabledToolIds: operationToolSet.enabledToolIds,
      forceFinish: state.forceFinish,
      localSystemManifest: LocalSystemManifest as unknown as LobeToolManifest,
      operationManifestMap: operationToolSet.manifestMap,
    });

    const toolResolver = new ToolResolver();
    const resolved: ResolvedToolSet = toolResolver.resolve(
      operationToolSet,
      stepDelta,
      state.activatedStepTools ?? [],
    );

    const tools = resolved.tools.length > 0 ? resolved.tools : undefined;
    const toolDiscoveryConfig = buildToolDiscoveryConfig(operationToolSet, resolved.enabledToolIds);

    if (stepDelta.activatedTools.length > 0) {
      log(
        `[${operationId}:${stepIndex}] ToolResolver injected %d step-level tools: %o`,
        stepDelta.activatedTools.length,
        stepDelta.activatedTools.map((t) => t.id),
      );
    }

    // Resolve skills via SkillResolver (unified skill injection)
    const skillResolver = new SkillResolver();
    const stepSkillDelta = buildStepSkillDelta();
    const resolvedSkills = state.metadata?.operationSkillSet
      ? skillResolver.resolve(
          state.metadata.operationSkillSet,
          stepSkillDelta,
          state.activatedStepSkills ?? [],
        )
      : undefined;

    if (!model || !provider) {
      throw new Error('Model and provider are required for call_llm instruction');
    }

    // Type assertion to ensure payload correctness
    const operationLogId = `${operationId}:${stepIndex}`;

    const stagePrefix = `[${operationLogId}][call_llm]`;

    log(`${stagePrefix} Starting operation`);

    // Get parentId from payload (parentId or parentMessageId depending on payload type)
    const parentId =
      prepared?.parentId ?? llmPayload.parentId ?? (llmPayload as any).parentMessageId;

    // Parent existence preflight ():
    // If the parent was deleted concurrently (e.g. user deleted topic mid-run),
    // assistant message creation below would hit a PG FK violation AFTER we've
    // already done the LLM call and spent tokens. Check first — fail fast,
    // save cost, and surface a typed error the frontend can act on instead of
    // a raw SQL error.
    if (!prepared && parentId) {
      const parentExists = await ctx.messageModel.findById(parentId);
      if (!parentExists) {
        const error = createConversationParentMissingError(parentId);
        await streamManager.publishStreamEvent(operationId, {
          data: formatErrorEventData(error, 'parent_message_preflight'),
          stepIndex,
          type: 'error',
        });
        throw error;
      }
    }

    // Get or create assistant message
    // If assistantMessageId is provided in payload, use existing message instead of creating new one
    const existingAssistantMessageId = (llmPayload as any).assistantMessageId;
    let assistantMessageItem: { id: string };
    // Seed fields for the client to insert this message into its local store.
    // The step_start uiMessages snapshot is resolved BEFORE this row exists,
    // so the client has no other way to learn about it until the next DB
    // refetch — chunks would silently no-op against the missing id (LOBE-11501).
    let assistantMessageSeed: Record<string, unknown> | undefined;

    if (prepared) {
      assistantMessageItem = prepared.assistantMessage;
      log(`${stagePrefix} Using prepared assistant message: %s`, assistantMessageItem.id);
    } else if (existingAssistantMessageId) {
      // Use existing assistant message (created by execAgent)
      assistantMessageItem = { id: existingAssistantMessageId };
      log(`${stagePrefix} Using existing assistant message: %s`, existingAssistantMessageId);
      const existingRow = await ctx.messageModel.findById(existingAssistantMessageId);
      if (existingRow) assistantMessageSeed = existingRow;
    } else {
      // Create new assistant message (legacy behavior)
      assistantMessageItem = await ctx.messageModel.create({
        agentId: state.metadata!.agentId!,
        content: '',
        groupId: state.metadata?.groupId ?? undefined,
        model,
        parentId,
        provider,
        role: 'assistant',
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      });
      assistantMessageSeed = assistantMessageItem as Record<string, unknown>;
      log(`${stagePrefix} Created new assistant message: %s`, assistantMessageItem.id);
    }

    // Publish stream start event
    const stepLabel = prepared?.stepLabel ?? (instruction as any).stepLabel;
    if (!prepared) {
      await streamManager.publishStreamEvent(operationId, {
        data: {
          // Only the seed fields the client needs — not the whole DB row.
          assistantMessage: {
            id: assistantMessageItem.id,
            ...(assistantMessageSeed && {
              agentId: assistantMessageSeed.agentId,
              groupId: assistantMessageSeed.groupId,
              model: assistantMessageSeed.model,
              parentId: assistantMessageSeed.parentId,
              provider: assistantMessageSeed.provider,
              role: assistantMessageSeed.role,
              threadId: assistantMessageSeed.threadId,
              topicId: assistantMessageSeed.topicId,
            }),
          },
          model,
          provider,
          ...(stepLabel && { stepLabel }),
        },
        stepIndex,
        type: 'stream_start',
      });
    }

    try {
      type ContentPart = { text: string; type: 'text' } | { image: string; type: 'image' };
      let shouldReplayAssistantReasoning = false;
      let preserveThinkingForPayload: boolean | undefined;
      let resolvedExtendParams: ModelExtendParams | undefined;

      // Process messages through serverMessagesEngine to inject system role, knowledge, etc.
      // Rebuild params from agentConfig at execution time (capabilities built dynamically)
      const agentConfig = ctx.agentConfig;
      let processedMessages;
      if (agentConfig) {
        const { loadModels } = await import('@/business/client/model-bank/loadModels');
        const builtinModels = await loadModels();

        const preserveThinkingConfigured =
          typeof agentConfig.chatConfig?.preserveThinking === 'boolean'
            ? agentConfig.chatConfig.preserveThinking
            : undefined;
        const preserveThinkingRequested = preserveThinkingConfigured === true;

        const readExtendParams = (
          card: (typeof builtinModels)[number] | undefined,
        ): string[] | undefined =>
          card &&
          'settings' in card &&
          card.settings &&
          typeof card.settings === 'object' &&
          'extendParams' in card.settings
            ? (card.settings as { extendParams?: string[] }).extendParams
            : undefined;

        const modelCard = builtinModels.find(
          (item) =>
            item.providerId === provider &&
            (item.id === model || item.config?.deploymentName === model),
        );
        const canonicalModelCard = builtinModels.find(
          (item) => item.id === model || item.config?.deploymentName === model,
        );
        const modelKnowledgeCutoff =
          modelCard?.knowledgeCutoff ??
          (provider === ModelProvider.LobeHub ? canonicalModelCard?.knowledgeCutoff : undefined);
        let modelDisplayName =
          modelCard?.displayName ??
          (provider === ModelProvider.LobeHub ? canonicalModelCard?.displayName : undefined);

        // Custom/remote user models aren't in the bundled model bank, so both cards
        // miss. Fall back to the user's own AI model record so server-side runs still
        // surface identity (the inbox `{{model}}` fallback no longer exists).
        if (!modelDisplayName && ctx.serverDB && ctx.userId) {
          try {
            const aiModelModel = new AiModelModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
            const userModel = await aiModelModel.findByIdAndProvider(model, provider);
            modelDisplayName = userModel?.displayName ?? undefined;
          } catch (error) {
            log('Failed to resolve user model display name for %s: %O', model, error);
          }
        }

        let modelExtendParams = readExtendParams(modelCard);

        // Aggregation providers (e.g. `lobehub`) may serve a model without copying
        // its origin `settings.extendParams`. Fall back to the canonical model card
        // (matched by id across any provider) so reasoning/thinking params like
        // `thinkingLevel` still reach the model. Mirrors the client-side
        // `transformToAiModelList` re-namespacing behavior.
        if (!modelExtendParams || modelExtendParams.length === 0) {
          modelExtendParams = readExtendParams(canonicalModelCard);
        }

        const modelSupportsPreserveThinkingFromCard =
          Array.isArray(modelExtendParams) && modelExtendParams.includes('preserveThinking');
        // Kimi K2.7+ Code has preserved thinking always active and cannot opt out.
        const kimiForcesPreserveThinking =
          (provider === 'moonshot' || provider === BRANDING_PROVIDER) &&
          isKimiAlwaysPreserveThinkingModel(model);
        // DeepSeek V4 / reasoner thinking models MUST replay the real assistant
        // reasoning in history — this is mandatory, not opt-in. Their
        // Anthropic-compatible API rejects an assistant tool-call turn whose
        // thinking block is missing (HTTP 400), so stripping reasoning leaves the
        // payload builder no choice but to emit a whitespace-only placeholder
        // thinking block. Under large agentic context that degenerate history makes
        // the model emit its final answer *inside* the thinking block with empty
        // visible text (controlled replay: ~30% answer-in-thinking with the
        // placeholder vs ~2.5% when the genuine reasoning is replayed). The only
        // opt-out is a V4 model whose thinking the user explicitly disabled via
        // `deepseekV4ReasoningEffort: 'none'`. That flag is V4-specific and may
        // linger on an agent after switching models, so it must NOT suppress
        // replay for `deepseek-reasoner`, which is thinking-only and always
        // forces reasoning history in the payload builder — suppressing it there
        // would reintroduce the 400/answer-hidden behavior.
        const deepseekV4ThinkingDisabled =
          isDeepSeekV4FamilyModel(model) &&
          agentConfig.chatConfig?.deepseekV4ReasoningEffort === 'none';
        const deepseekForcesPreserveThinking =
          isDeepSeekThinkingEligibleModel(model) && !deepseekV4ThinkingDisabled;
        const modelForcesPreserveThinking =
          kimiForcesPreserveThinking || deepseekForcesPreserveThinking;
        const providerSupportsPreserveThinkingFallback =
          provider === 'qwen' || provider === 'zhipu' || provider === 'moonshot';
        const modelSupportsPreserveThinking =
          modelForcesPreserveThinking ||
          modelSupportsPreserveThinkingFromCard ||
          (!modelCard && providerSupportsPreserveThinkingFallback);

        shouldReplayAssistantReasoning =
          (modelForcesPreserveThinking || preserveThinkingRequested) &&
          modelSupportsPreserveThinking;
        preserveThinkingForPayload = modelForcesPreserveThinking
          ? true
          : modelSupportsPreserveThinking && typeof preserveThinkingConfigured === 'boolean'
            ? preserveThinkingConfigured
            : undefined;

        // Resolve model extend params (thinkingLevel, reasoning effort, urlContext, …)
        // from the agent chat config so the server-side agent runtime forwards the same
        // runtime params the client chat service does. Without this, e.g. Gemini 3 Pro's
        // `thinkingLevel` never reaches the request and thought summaries come back empty.
        if (agentConfig.chatConfig) {
          resolvedExtendParams = applyModelExtendParams({
            chatConfig: agentConfig.chatConfig,
            extendParams: modelExtendParams as ExtendParamsType[] | undefined,
            model,
          });
        }

        const messagesForContext = shouldReplayAssistantReasoning
          ? (llmPayload.messages as UIChatMessage[])
          : stripAssistantReasoningForReplay(llmPayload.messages as UIChatMessage[]);

        // Extract <refer_topic> tags from messages and fetch summaries.
        // Skip if messages already contain injected topic_reference_context
        // (e.g., from client-side contextEngineering preprocessing) to avoid double injection.
        let topicReferences;
        const alreadyHasTopicRefs = (
          messagesForContext as Array<{ content: string | unknown }>
        ).some(
          (m) => typeof m.content === 'string' && m.content.includes('topic_reference_context'),
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

        // Fetch agent documents for context injection
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

        // Detect onboarding agent and build context injection
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
        //
        // - agent_title / agent_description: read directly from agentConfig,
        //   which is the result of AgentModel.getAgentConfig() and already
        //   contains the full enriched agent record (title, description, ...).
        //   No extra query needed.
        // - topic_title: requires a single primary-key lookup against the
        //   topics table. Skipped when topicId is missing or the lookup fails
        //   (best-effort, falls back to empty string so the template still
        //   renders cleanly).
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
          agent_id: lobehubSkillAgentId ?? '',
          agent_title: lobehubSkillAgentMeta?.title ?? '',
          agent_description: lobehubSkillAgentMeta?.description ?? '',
          topic_id: lobehubSkillTopicId ?? '',
          topic_title: lobehubSkillTopicTitle,
        };

        // ── Tool-specific template variable resolution ────────────────────
        // The client-side contextEngineering.ts resolves these via Zustand stores
        // and lambdaClient. In execAgent (server/bot) mode we must fetch from DB
        // directly. Each block is gated on the relevant tool being enabled.

        // {{username}} / {{language}} — used by memory and creds system roles.
        // Single indexed DB lookup; cheap enough to run on each call_llm step.
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

        // {{sandbox_enabled}} — mirrors client-side check for lobe-cloud-sandbox.
        const sandboxEnabled = String(resolved.enabledToolIds.includes('lobe-cloud-sandbox'));

        // {{sandbox_uploaded_files}} — lists the topic/session files that are
        // synced into the sandbox upload dir, so the agent knows they exist.
        // Mirrors the bootstrap query in SandboxMiddlewareService.
        let sandboxUploadedFiles = '';
        if (sandboxEnabled === 'true' && ctx.serverDB && ctx.userId && lobehubSkillTopicId) {
          try {
            const { formatUploadedFilesPrompt } =
              await import('@lobechat/builtin-tool-cloud-sandbox');
            const fileModel = new FileModel(ctx.serverDB, ctx.userId);
            const uploadedFiles = await fileModel.findFilesToInitInSandbox(lobehubSkillTopicId);
            sandboxUploadedFiles = formatUploadedFilesPrompt(uploadedFiles);
          } catch (error) {
            log('Failed to resolve files for {{sandbox_uploaded_files}} substitution: %O', error);
          }
        }

        // {{session_date}} — current date formatted for user's timezone.
        const sessionDate = new Intl.DateTimeFormat('en-US', {
          day: 'numeric',
          month: 'long',
          timeZone: ctx.userTimezone || 'UTC',
          weekday: 'long',
          year: 'numeric',
        }).format(new Date());

        // {{memory_effort}} — read from agentConfig chatConfig; no extra query needed.
        const memoryEffort = String(
          (state.metadata?.agentConfig as any)?.chatConfig?.memory?.effort ?? '',
        );

        // {{CREDS_LIST}} — used by lobe-creds system role.
        // Always fetched when userId is available so substitution works regardless of which
        // execution path (execAgent / client-side activator) injected the system role.
        let credsListStr = '';
        if (ctx.userId) {
          try {
            const marketService = new MarketService({ userInfo: { userId: ctx.userId } });
            // Inside a workspace, the agent must only see the workspace's shared
            // organization credentials — personal creds are not visible here (LOBE-10978).
            const credsResult = ctx.workspaceId
              ? await marketService.market.organizations
                  .creds({ workspaceId: ctx.workspaceId })
                  .list()
              : await marketService.market.creds.list();
            const userCreds = (credsResult as any)?.data ?? [];
            credsListStr = generateCredsList(
              userCreds.map((cred: any): CredSummary => ({
                description: cred.description,
                key: cred.key,
                name: cred.name,
                // Only present on the workspace-merged list (organizations.creds().list())
                // above — tells the AI whether this credential is the workspace's own or a
                // member's shared one, so it never misrepresents whose secret it's using.
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

        // {{COMPOSIO_SERVICES_LIST}} — used by lobe-creds system role (Composio integrations section).
        let composioServicesListStr = '';
        if (ctx.serverDB && ctx.userId && !!composioEnv.COMPOSIO_API_KEY) {
          try {
            const pluginModel = new PluginModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
            const allPlugins = await pluginModel.query();
            const validComposioIds = new Set(COMPOSIO_APP_TYPES.map((t) => t.identifier));
            const connectedIds = new Set(
              allPlugins
                .filter(
                  (p) =>
                    validComposioIds.has(p.identifier) &&
                    (p.customParams as any)?.composio?.status === 'ACTIVE',
                )
                .map((p) => p.identifier),
            );
            // Disabled services are dropped from both lists — not surfaced as
            // "connected, use directly" (this agent shouldn't use it) nor as
            // "available to connect" (the account-level OAuth connection, if
            // any, is untouched; this agent just isn't meant to see it).
            let disabledIdSet = new Set<string>();
            if (agentId) {
              const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
              const agentConfig = await agentModel.getAgentConfigById(agentId);
              disabledIdSet = new Set(getDisabledPluginIds(agentConfig?.plugins ?? undefined));
            }
            const connected: ComposioServiceSummary[] = excludeDisabledComposioServices(
              COMPOSIO_APP_TYPES.filter((t) => connectedIds.has(t.identifier)),
              disabledIdSet,
            ).map((t) => ({ identifier: t.identifier, name: t.label }));
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

        // Agent Builder (gateway / server mode): the `<current_agent_context>`
        // that tells the builder LLM WHICH agent it is editing is built
        // CLIENT-side in chat mode (services/chat/index.ts). In gateway mode that
        // client code never runs, so without this the context is never injected
        // and the builder answers with its OWN config instead of the edited
        // agent's. `state.metadata.editingAgentId` is the agent being configured
        // (the builder builtin is `state.metadata.agentId`).
        let agentBuilderContext: AgentBuilderContext | undefined;
        const editingAgentId = state.metadata?.editingAgentId;
        if (editingAgentId && ctx.serverDB && ctx.userId) {
          try {
            const editingAgentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
            const editingConfig = (await editingAgentModel.getAgentConfigById(
              editingAgentId,
            )) as Record<string, any> | null;
            if (editingConfig) {
              // Build the `<available_official_tools>` list the same way the
              // client does (services/chat/index.ts). Without it the builder
              // prompt — which now relies on injected official tools instead of a
              // search API — can't see installable builtin/Composio tools or their
              // enabled/connected status, so the model may pick invalid ids or
              // claim a supported tool is unavailable.
              const enabledPlugins: string[] = getActivePluginIds(
                Array.isArray(editingConfig.plugins) ? editingConfig.plugins : undefined,
              );
              const composioIdentifiers = new Set(COMPOSIO_APP_TYPES.map((t) => t.identifier));
              const officialTools: OfficialToolItem[] = [];

              // Builtin tools — exclude hidden/infra tools (mirrors the client's
              // `metaList`) and Composio entries (listed separately below).
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

              // Composio MCP servers — only when Composio is configured for this
              // deployment. Connection status mirrors the existing
              // {{COMPOSIO_SERVICES_LIST}} logic (ACTIVE composio plugin rows).
              if (composioEnv.COMPOSIO_API_KEY) {
                try {
                  const pluginModel = new PluginModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
                  const allPlugins = await pluginModel.query();
                  const connectedComposioIds = new Set(
                    allPlugins
                      .filter(
                        (p) =>
                          composioIdentifiers.has(p.identifier) &&
                          (p.customParams as any)?.composio?.status === 'ACTIVE',
                      )
                      .map((p) => p.identifier),
                  );
                  for (const t of COMPOSIO_APP_TYPES) {
                    officialTools.push({
                      description: `LobeHub Mcp Server: ${t.label}`,
                      enabled: enabledPlugins.includes(t.identifier),
                      identifier: t.identifier,
                      installed: connectedComposioIds.has(t.identifier),
                      name: t.label,
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
            log(
              'Failed to build agentBuilderContext for editing agent %s: %O',
              editingAgentId,
              error,
            );
          }
        }

        const contextEngineInput = {
          agentDocuments,
          ...(agentBuilderContext && { agentBuilderContext }),
          // The group/bot member roster is resolved once at op creation
          // (AiAgentService.execAgent → buildGroupAgentContext) and snapshotted
          // into op metadata, mirroring agentConfig/botContext — no per-step DB
          // lookup here.
          agentGroup: state.metadata?.agentGroup as AgentGroupConfig | undefined,
          // Bridge the @-mentioned agents (persisted into the runtime
          // initialContext by AiAgentService.execAgent) into the agent-management
          // context so AgentManagementContextInjector injects the delegation
          // block, prompting the supervisor to `callAgent` the mentioned agents.
          // Mirrors the client's contextEngineering bridge; scoped to mention
          // runs only (undefined otherwise) so ordinary runs are unaffected.
          agentManagementContext: (state as any).initialContext?.initialContext?.mentionedAgents
            ?.length
            ? {
                mentionedAgents: (state as any).initialContext.initialContext.mentionedAgents,
              }
            : undefined,
          additionalVariables: {
            ...state.metadata?.deviceSystemInfo,
            ...lobehubSkillVariables,
            // User identity variables
            username: serverUsername,
            language: serverLanguage,
            session_date: sessionDate,
            // Creds tool variables
            sandbox_enabled: sandboxEnabled,
            sandbox_uploaded_files: sandboxUploadedFiles,
            CREDS_LIST: credsListStr,
            COMPOSIO_SERVICES_LIST: composioServicesListStr,
            // Memory tool variables
            memory_effort: memoryEffort,
          },
          userTimezone: ctx.userTimezone,
          capabilities: {
            isCanUseAudio: (m: string, p: string) => {
              const info =
                builtinModels.find((item) => item.id === m && item.providerId === p) ??
                builtinModels.find((item) => item.id === m);
              return info?.abilities?.audio ?? false;
            },
            isCanUseFC: (m: string, p: string) => {
              const info = builtinModels.find((item) => item.id === m && item.providerId === p);
              return info?.abilities?.functionCall ?? true;
            },
            isCanUseVideo: (m: string, p: string) => {
              const info =
                builtinModels.find((item) => item.id === m && item.providerId === p) ??
                builtinModels.find((item) => item.id === m);
              return info?.abilities?.video ?? false;
            },
            isCanUseVision: (m: string, p: string) => {
              // Aggregator providers (e.g. lobehub) route to upstream model cards
              // that live under the original provider's id in the registry, so
              // fall back to a cross-provider lookup by model id when the
              // (model, provider) pair has no direct entry.
              const info =
                builtinModels.find((item) => item.id === m && item.providerId === p) ??
                builtinModels.find((item) => item.id === m);
              return info?.abilities?.vision ?? false;
            },
          },
          botPlatformContext: ctx.botPlatformContext,
          discordContext: ctx.discordContext,
          enableHistoryCount: agentConfig.chatConfig?.enableHistoryCount ?? undefined,
          evalContext: ctx.evalContext,
          forceFinish: state.forceFinish,
          historyCount: resolveRuntimeHistoryCount(agentConfig.chatConfig?.historyCount),
          initialContext: (state as any).initialContext?.initialContext,
          knowledge: {
            fileContents: agentConfig.files
              ?.filter((f: { enabled?: boolean | null }) => f.enabled === true)
              .map((f: { content?: string | null; id?: string; name?: string }) => ({
                content: f.content ?? '',
                fileId: f.id ?? '',
                filename: f.name ?? '',
              })),
            knowledgeBases: agentConfig.knowledgeBases
              ?.filter((kb: { enabled?: boolean | null }) => kb.enabled === true)
              .map((kb: { id?: string; name?: string }) => ({
                id: kb.id ?? '',
                name: kb.name ?? '',
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
            manifests: Object.values(resolved.manifestMap),
            tools: resolved.enabledToolIds,
          },
          userMemory: state.metadata?.userMemory,

          // Skills configuration for <available_skills> injection.
          // In chat mode the MessagesEngine force-disables this injector via
          // its `enableAgentMode` param — no extra gate needed here.
          ...(resolvedSkills?.enabledSkills?.length && {
            skillsConfig: { enabledSkills: resolvedSkills.enabledSkills },
          }),
          enableAgentMode: agentConfig.chatConfig?.enableAgentMode,

          // Topic reference summaries
          ...(topicReferences && { topicReferences }),
          ...(onboardingContext && { onboardingContext }),
        };

        processedMessages = await agentRuntimeTracer.startActiveSpan(
          CONTEXT_ENGINEERING_SPAN_NAME,
          {
            attributes: buildContextEngineeringAttributes({
              hasImages: (messagesForContext as Array<{ content?: unknown }>).some(
                (m) =>
                  Array.isArray(m.content) &&
                  (m.content as Array<{ type?: string }>).some((p) => p?.type === 'image_url'),
              ),
              historyCompressed:
                Array.isArray(messagesForContext) &&
                messagesForContext.some((m: { role?: string }) => m?.role === 'compressedGroup'),
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

        // Hand context engine input/output to the trace sink out-of-band.
        // Omit large/redundant fields to reduce snapshot size:
        // - input.messages: reconstructible from step's messagesBaseline + messagesDelta
        // - input.toolsConfig: static per operation, ~47KB of manifests repeated every call_llm step
        // Keep output (processedMessages) — needed by inspect CLI for --env, --system-role, -m
        const {
          messages: _inputMsgs,
          toolsConfig: _toolsConfig,
          ...contextEngineInputLite
        } = contextEngineInput;
        ctx.tracingContextEngine?.(
          { ...contextEngineInputLite, toolCount: _toolsConfig?.tools?.length ?? 0 },
          processedMessages,
        );
      } else {
        processedMessages = llmPayload.messages;
      }

      // A turn must carry at least one non-system message. Anthropic-compatible
      // providers (anthropic / deepseek) move `role: system` into a separate
      // top-level field, so a system-only array dispatches `messages: []` and
      // the upstream rejects it with a 400 `messages: at least one message is
      // required` (surfaced as an opaque UpstreamHttpError); for other providers
      // a system-only turn has nothing to respond to. Either way the context
      // pipeline dropped everything real — fail fast with a locatable internal
      // error instead of a doomed round-trip. Attributed here (agent-runtime),
      // not the provider layer, since it's our own pipeline that emptied it.
      if (!processedMessages.some((message) => message.role !== 'system')) {
        throw new Error(
          `call_llm produced no non-system messages for ${provider}/${model} ` +
            `(topic=${state.metadata?.topicId ?? 'n/a'}, step=${stepIndex}); refusing to dispatch`,
        );
      }

      // Initialize ModelRuntime (read user's keyVaults from database)
      const modelRuntime = await initModelRuntimeFromDB(
        ctx.serverDB,
        ctx.userId!,
        provider,
        ctx.workspaceId,
      );

      // Construct ChatStreamPayload
      const stream = ctx.stream ?? true;
      const chatPayload = {
        messages: processedMessages,
        model,
        stream,
        tools,
        // ModelExtendParams keeps provider-specific effort/thinking values as loose
        // strings (e.g. hy3's 'no_think'); the runtime payload narrows them, so cast.
        ...(resolvedExtendParams as Partial<ChatStreamPayload>),
        ...(typeof preserveThinkingForPayload === 'boolean' && {
          preserveThinking: preserveThinkingForPayload,
        }),
      };

      // Buffer: accumulate text and reasoning, send every 50ms
      const BUFFER_INTERVAL = 50;
      let textBuffer = '';
      let reasoningBuffer = '';

      let textBufferTimer: NodeJS.Timeout | null = null;
      let reasoningBufferTimer: NodeJS.Timeout | null = null;

      const flushTextBuffer = async () => {
        const delta = textBuffer;
        textBuffer = '';

        if (!!delta) {
          log(`[${operationLogId}] flushTextBuffer:`, delta);

          // Build standard Agent Runtime event
          events.push({
            chunk: { text: delta, type: 'text' },
            type: 'llm_stream',
          });

          const publishStart = Date.now();
          await streamManager.publishStreamChunk(operationId, stepIndex, {
            chunkType: 'text',
            content: delta,
          });
          timing(
            '[%s] flushTextBuffer published at %d, took %dms, length: %d',
            operationLogId,
            publishStart,
            Date.now() - publishStart,
            delta.length,
          );
        }
      };

      const flushReasoningBuffer = async () => {
        const delta = reasoningBuffer;

        reasoningBuffer = '';

        if (!!delta) {
          log(`[${operationLogId}] flushReasoningBuffer:`, delta);

          events.push({
            chunk: { text: delta, type: 'reasoning' },
            type: 'llm_stream',
          });

          const publishStart = Date.now();
          await streamManager.publishStreamChunk(operationId, stepIndex, {
            chunkType: 'reasoning',
            reasoning: delta,
          });
          timing(
            '[%s] flushReasoningBuffer published at %d, took %dms, length: %d',
            operationLogId,
            publishStart,
            Date.now() - publishStart,
            delta.length,
          );
        }
      };

      // File service + date shard used to persist model-generated images
      // (Gemini multimodal `content_part`/`reasoning_part` images) to object
      // storage, built once and reused across parts. The `userId` check only
      // satisfies its optional type — it is always present in this executor.
      // A missing-S3-config failure surfaces later at uploadBase64 (caught per
      // image in uploadPartImage), never at construction.
      const imageUploadService = ctx.userId ? new FileService(ctx.serverDB, ctx.userId) : undefined;
      const imageUploadDate = new Date().toISOString().split('T')[0];

      // Coalesce a streamed text chunk into the trailing text part (mirrors the
      // client StreamingHandler) so serialized multimodal content stays compact
      // and preserves text/image ordering.
      const appendTextPart = (parts: ContentPart[], text: string) => {
        const last = parts.at(-1);
        if (last && last.type === 'text') {
          parts[parts.length - 1] = { text: last.text + text, type: 'text' };
        } else {
          parts.push({ text, type: 'text' });
        }
      };

      // Persist a base64 image part to object storage and swap the placeholder
      // part for one referencing the uploaded URL. Runs concurrently with the
      // rest of the stream; a failed upload leaves the inline data-URI so the
      // image still renders. Never stores raw base64 in the message on success.
      const uploadPartImage = (
        parts: ContentPart[],
        partIndex: number,
        base64: string,
        mimeType: string | undefined,
      ): Promise<void> => {
        if (!imageUploadService) return Promise.resolve();
        const ext = mimeType?.split('/')[1] || 'png';
        const pathname = `${fileEnv.NEXT_PUBLIC_S3_FILE_PATH}/generations/${imageUploadDate}/${nanoid()}.${ext}`;
        return imageUploadService
          .uploadBase64(base64, pathname)
          .then(({ url }) => {
            parts[partIndex] = { image: url, type: 'image' };
          })
          .catch((error) => {
            console.error(`[${operationLogId}][content_part] image upload failed:`, error);
          });
      };

      const maxAttempts = resolveLLMMaxAttempts(provider, SERVER_LLM_RETRY_POLICY);

      // OTel chat span — wraps all retry attempts; TTFT recorded on the first
      // text/reasoning chunk regardless of which attempt produced it (the
      // semantic span represents the LLM call from the agent's perspective).
      const llmStartTime = Date.now();
      let firstChunkAt: number | undefined;
      const chatSpan = agentRuntimeTracer.startSpan(chatSpanName(model), {
        attributes: buildChatRequestAttributes({
          conversationId: state.metadata?.topicId,
          operationId,
          provider,
          requestModel: model,
          stepIndex,
          stream,
        }),
        kind: SpanKind.CLIENT,
      });
      const chatCtx = otelTrace.setSpan(otelContext.active(), chatSpan);

      try {
        return await otelContext.with(chatCtx, async () => {
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            let content = '';
            let toolsCalling: ChatToolPayload[] = [];
            let tool_calls: MessageToolCall[] = [];
            let thinkingContent = '';
            const imageList: any[] = [];
            let grounding: any = null;
            let currentStepUsage: any = undefined;
            let currentStepSpeed: any = undefined;
            let currentStepFinishReason: string | undefined = undefined;
            let streamError: any = undefined;
            const contentParts: ContentPart[] = [];
            const reasoningParts: ContentPart[] = [];
            const contentImageUploads: Promise<void>[] = [];
            const reasoningImageUploads: Promise<void>[] = [];
            let hasContentImages = false;
            let hasReasoningImages = false;
            // Set when a terminal turn's answer was salvaged from the reasoning
            // channel (see the answer-in-thinking guard below) — surfaced in
            // message metadata for observability.
            let answerSalvagedFromReasoning = false;
            textBuffer = '';
            reasoningBuffer = '';

            const clearAttemptBuffers = () => {
              if (textBufferTimer) {
                clearTimeout(textBufferTimer);
                textBufferTimer = null;
              }

              if (reasoningBufferTimer) {
                clearTimeout(reasoningBufferTimer);
                reasoningBufferTimer = null;
              }

              textBuffer = '';
              reasoningBuffer = '';
            };

            try {
              log(
                `${stagePrefix} calling model-runtime chat (attempt %d/%d, model: %s, messages: %d, tools: %d)`,
                attempt,
                maxAttempts,
                model,
                processedMessages.length,
                tools?.length ?? 0,
              );

              // Call model-runtime chat
              const response = await modelRuntime.chat(chatPayload, {
                callback: {
                  onCompletion: async (data) => {
                    // Capture usage (may or may not include cost)
                    if (data.usage) {
                      currentStepUsage = data.usage;
                    }
                    // Capture performance metrics (tps / ttft / duration / latency)
                    if (data.speed) {
                      currentStepSpeed = data.speed;
                    }
                    // Capture provider's terminal finishReason so soft interrupts
                    // (e.g. Gemini RECITATION / MAX_TOKENS with empty content)
                    // are visible in tracing instead of being silently swallowed.
                    if (data.finishReason) {
                      currentStepFinishReason = data.finishReason;
                    }
                  },
                  onGrounding: async (groundingData) => {
                    log(`[${operationLogId}][grounding] %O`, groundingData);
                    grounding = groundingData;

                    await streamManager.publishStreamChunk(operationId, stepIndex, {
                      chunkType: 'grounding',
                      grounding: groundingData,
                    });
                  },
                  onText: async (text) => {
                    if (firstChunkAt === undefined) {
                      firstChunkAt = Date.now() - llmStartTime;
                    }
                    timing(
                      '[%s] onText received chunk at %d, length: %d',
                      operationLogId,
                      Date.now(),
                      text.length,
                    );
                    content += text;

                    textBuffer += text;

                    // If no timer exists, create one
                    if (!textBufferTimer) {
                      textBufferTimer = setTimeout(async () => {
                        await flushTextBuffer();
                        textBufferTimer = null;
                      }, BUFFER_INTERVAL);
                    }
                  },
                  onThinking: async (reasoning) => {
                    if (firstChunkAt === undefined) {
                      firstChunkAt = Date.now() - llmStartTime;
                    }
                    timing(
                      '[%s] onThinking received chunk at %d, length: %d',
                      operationLogId,
                      Date.now(),
                      reasoning.length,
                    );
                    thinkingContent += reasoning;

                    // Buffer reasoning content
                    reasoningBuffer += reasoning;

                    // If no timer exists, create one
                    if (!reasoningBufferTimer) {
                      reasoningBufferTimer = setTimeout(async () => {
                        await flushReasoningBuffer();
                        reasoningBufferTimer = null;
                      }, BUFFER_INTERVAL);
                    }
                  },
                  // Gemini 2.5+/3 multimodal streams deliver assistant text and
                  // reasoning as `content_part`/`reasoning_part` events (triggered by
                  // thought parts / thoughtSignature) instead of plain `text`/
                  // `reasoning`. Without these handlers the text is silently dropped:
                  // `onCompletion` still reports usage tokens, so the empty-completion
                  // guard sees outputTokens > 0 and finalizes the turn to a blank
                  // `done`. Mirror onText/onThinking for text parts so streaming,
                  // persistence and tracing all capture the content; upload image
                  // parts to object storage and serialize the multimodal content
                  // (text + image URLs, in order) — never persist raw base64.
                  onContentPart: async (part) => {
                    if (firstChunkAt === undefined) {
                      firstChunkAt = Date.now() - llmStartTime;
                    }

                    if (part.partType === 'image') {
                      const partIndex = contentParts.length;
                      contentParts.push({
                        image: `data:${part.mimeType || 'image/png'};base64,${part.content}`,
                        type: 'image',
                      });
                      hasContentImages = true;
                      contentImageUploads.push(
                        uploadPartImage(contentParts, partIndex, part.content, part.mimeType),
                      );
                      return;
                    }

                    content += part.content;
                    appendTextPart(contentParts, part.content);
                    textBuffer += part.content;

                    if (!textBufferTimer) {
                      textBufferTimer = setTimeout(async () => {
                        await flushTextBuffer();
                        textBufferTimer = null;
                      }, BUFFER_INTERVAL);
                    }
                  },
                  // Some Gemini / Nano Banana image responses arrive via the
                  // legacy single-image `base64_image` event instead of
                  // `content_part` (the Google stream transform emits it when a
                  // response can't be classified as multimodal). Without this
                  // handler the image is silently dropped server-side — never
                  // uploaded, never persisted — and, on channels that omit the
                  // Image response modality, the raw base64 leaks into text and
                  // bloats the context. Mirror the onContentPart image branch:
                  // register a placeholder part, upload to object storage, and
                  // mark the turn multimodal so raw base64 never lands in content.
                  onBase64Image: async ({ image }) => {
                    if (firstChunkAt === undefined) {
                      firstChunkAt = Date.now() - llmStartTime;
                    }

                    // `image.data` is a full data URI (`data:<mime>;base64,<...>`).
                    const mimeType = /^data:([^;]+);/.exec(image.data)?.[1];
                    const partIndex = contentParts.length;
                    contentParts.push({ image: image.data, type: 'image' });
                    hasContentImages = true;
                    contentImageUploads.push(
                      uploadPartImage(contentParts, partIndex, image.data, mimeType),
                    );
                  },
                  onReasoningPart: async (part) => {
                    if (firstChunkAt === undefined) {
                      firstChunkAt = Date.now() - llmStartTime;
                    }

                    if (part.partType === 'image') {
                      const partIndex = reasoningParts.length;
                      reasoningParts.push({
                        image: `data:${part.mimeType || 'image/png'};base64,${part.content}`,
                        type: 'image',
                      });
                      hasReasoningImages = true;
                      reasoningImageUploads.push(
                        uploadPartImage(reasoningParts, partIndex, part.content, part.mimeType),
                      );
                      return;
                    }

                    thinkingContent += part.content;
                    appendTextPart(reasoningParts, part.content);
                    reasoningBuffer += part.content;

                    if (!reasoningBufferTimer) {
                      reasoningBufferTimer = setTimeout(async () => {
                        await flushReasoningBuffer();
                        reasoningBufferTimer = null;
                      }, BUFFER_INTERVAL);
                    }
                  },
                  onToolsCalling: async ({ toolsCalling: raw }) => {
                    const resolvedCalls = new ToolNameResolver().resolve(raw, resolved.manifestMap);
                    // Attach source (origin) and executor (dispatch target) for routing.
                    // `arguments` are kept RAW here on purpose so the tool executor can
                    // still detect malformed JSON and return an `INVALID_JSON_ARGUMENTS`
                    // tool-result with the original bad string — that's the
                    // self-reflection signal the model needs to fix its own output.
                    // Sanitization happens later, only at the persist boundaries
                    // (DB write and state.messages push) to protect strict providers
                    // replaying history. See .
                    const payload = resolvedCalls.map((p) => ({
                      ...p,
                      executor: resolved.executorMap?.[p.identifier],
                      source: resolved.sourceMap[p.identifier],
                    }));
                    // log(`[${operationLogId}][toolsCalling]`, payload);
                    toolsCalling = payload;
                    tool_calls = raw;

                    // If textBuffer exists, flush it first
                    if (!!textBuffer) {
                      await flushTextBuffer();
                    }

                    await streamManager.publishStreamChunk(operationId, stepIndex, {
                      chunkType: 'tools_calling',
                      toolsCalling: payload,
                    });
                  },
                  onError: async (errorData) => {
                    streamError = errorData;
                    console.error(`[${operationLogId}][stream_error]`, errorData);
                  },
                },
                metadata: {
                  operationId,
                  topicId: state.metadata?.topicId,
                  trigger: state.metadata?.trigger,
                },
                user: ctx.userId,
              });

              // Consume stream to ensure all callbacks complete execution
              await consumeStreamUntilDone(response);

              // If a stream error was captured via onError callback, throw to propagate the error
              if (streamError) {
                const streamExecutionError = new Error(
                  typeof streamError.message === 'string'
                    ? `LLM stream error: ${streamError.message}`
                    : `LLM stream error: ${JSON.stringify(streamError)}`,
                );
                const { message: _message, ...restStreamError } = streamError as Record<
                  string,
                  unknown
                >;
                Object.assign(streamExecutionError, restStreamError);
                throw streamExecutionError;
              }

              await flushTextBuffer();
              await flushReasoningBuffer();
              clearAttemptBuffers();

              // Wait for any model-generated image uploads to finish so the
              // persisted multimodal content references S3 URLs, not base64.
              if (contentImageUploads.length > 0 || reasoningImageUploads.length > 0) {
                await Promise.allSettled([...contentImageUploads, ...reasoningImageUploads]);
              }

              // Empty-completion guard: if the model produced
              // nothing actionable — no content, reasoning, tool calls, images,
              // or output tokens — throw so the retry loop below re-attempts the
              // turn instead of finalizing to `done` with a blank assistant
              // message. Skipped when the user interrupted mid-stream, where an
              // empty turn is expected and must not be retried.
              const reportedOutputTokens =
                currentStepUsage && typeof currentStepUsage === 'object'
                  ? (currentStepUsage as { totalOutputTokens?: unknown }).totalOutputTokens
                  : undefined;

              if (
                isEmptyModelCompletion({
                  content,
                  imageCount: imageList.length,
                  outputTokens:
                    typeof reportedOutputTokens === 'number' ? reportedOutputTokens : undefined,
                  reasoning: thinkingContent,
                  toolCallCount: toolsCalling.length + tool_calls.length,
                }) &&
                !(await isOperationInterrupted(ctx))
              ) {
                log(
                  '[%s] Model returned an empty completion (attempt %d/%d) — throwing ModelEmptyError to retry',
                  operationLogId,
                  attempt,
                  maxAttempts,
                );
                throw new ModelEmptyError(undefined, {
                  attempt,
                  contentLength: content.length,
                  finishReason: currentStepFinishReason,
                  imageCount: imageList.length,
                  maxAttempts,
                  model,
                  outputTokens:
                    typeof reportedOutputTokens === 'number' ? reportedOutputTokens : undefined,
                  provider,
                  reasoningLength: thinkingContent.length,
                  toolCallCount: toolsCalling.length + tool_calls.length,
                });
              }

              // Answer-in-thinking salvage: some thinking-mode models — notably
              // DeepSeek V4 over the Anthropic-compatible API — occasionally emit
              // the final user-facing answer inside the reasoning channel and stop
              // naturally with an empty text block. The reasoning is then rendered
              // as a collapsed "thinking" panel, so the user sees a blank reply.
              // When a turn ends naturally with no tool calls and no visible
              // content but non-empty text reasoning, promote the reasoning to be
              // the answer. This is a backstop; the primary fix is replaying the
              // real assistant reasoning in history (see modelForcesPreserveThinking
              // above) which sharply reduces how often the model does this.
              const isTerminalNaturalStop =
                currentStepFinishReason === 'end_turn' || currentStepFinishReason === 'stop';
              if (
                isTerminalNaturalStop &&
                toolsCalling.length === 0 &&
                tool_calls.length === 0 &&
                content.trim().length === 0 &&
                thinkingContent.trim().length > 0 &&
                !hasReasoningImages
              ) {
                log(
                  '[%s] answer-in-thinking salvage: promoting %d chars of reasoning to content',
                  operationLogId,
                  thinkingContent.length,
                );
                content = thinkingContent;
                thinkingContent = '';
                answerSalvagedFromReasoning = true;
              }

              log(
                `[${operationLogId}] finish model-runtime calling | content: %d chars | reasoning: %d chars | tools: %d | usage: %s`,
                content.length,
                thinkingContent.length,
                toolsCalling.length,
                currentStepUsage ? 'yes' : 'none',
              );

              if (thinkingContent) {
                log(`[${operationLogId}][reasoning]`, thinkingContent);
              }
              if (content) {
                log(`[${operationLogId}][content]`, content);
              }
              if (toolsCalling.length > 0) {
                log(`[${operationLogId}][toolsCalling] `, toolsCalling);
              }

              // Log usage information
              if (currentStepUsage) {
                log(`[${operationLogId}][usage] %O`, currentStepUsage);
              }

              // Add a complete llm_stream event (including all streaming chunks)
              events.push({
                result: {
                  content,
                  finishReason: currentStepFinishReason,
                  reasoning: thinkingContent,
                  tool_calls,
                  usage: currentStepUsage,
                },
                type: 'llm_result',
              });

              // Publish stream end event
              await streamManager.publishStreamEvent(operationId, {
                data: {
                  finalContent: content,
                  grounding,
                  ...(stepLabel && { stepLabel }),
                  imageList: imageList.length > 0 ? imageList : undefined,
                  reasoning: thinkingContent || undefined,
                  toolsCalling,
                  usage: currentStepUsage,
                },
                stepIndex,
                type: 'stream_end',
              });

              const canPublishEarlyFinalAnswerVisibleEnd =
                ctx.allowEarlyFinalAnswerVisibleOutputEnd ?? true;
              if (
                canPublishEarlyFinalAnswerVisibleEnd &&
                toolsCalling.length === 0 &&
                tool_calls.length === 0
              ) {
                try {
                  // Example: a no-tool answer can publish stream_end, then spend
                  // several seconds in DB/Redis persistence before terminal done.
                  // Clear visible loading once no more text/tool output can appear.
                  await streamManager.publishStreamEvent(operationId, {
                    data: { reason: 'final_answer' },
                    stepIndex,
                    type: 'visible_output_end',
                  });
                  visibleOutputEndPublishedStepIndex = stepIndex;
                } catch (error) {
                  // Terminal saveStepResult still publishes the same hint as a fallback.
                  console.error('Failed to publish visible_output_end:', error);
                }
              }

              log('[%s:%d] call_llm completed', operationId, stepIndex);

              // ===== 1. First save original usage to message.metadata =====
              // Determine final content - use serialized parts if has images, otherwise plain text
              const finalContent = hasContentImages
                ? serializePartsForStorage(contentParts)
                : content;

              // Determine final reasoning - handle multimodal reasoning
              let finalReasoning: any = undefined;
              if (hasReasoningImages) {
                // Has images, use multimodal format
                finalReasoning = {
                  content: serializePartsForStorage(reasoningParts),
                  isMultimodal: true,
                };
              } else if (thinkingContent) {
                // Has text from reasoning but no images
                finalReasoning = {
                  content: thinkingContent,
                };
              }

              // preserveThinking only gates whether reasoning is replayed into the
              // next LLM payload (state.messages); the DB copy powers UI display
              // after refresh and must always be saved.
              const replayedReasoning = shouldReplayAssistantReasoning ? finalReasoning : undefined;

              try {
                // Build metadata object
                const metadata: Record<string, any> = {};
                if (currentStepUsage && typeof currentStepUsage === 'object') {
                  // Flat fields are kept for backward-compatible readers; `usage`
                  // is the canonical nested shape new readers should consume.
                  Object.assign(metadata, currentStepUsage);
                  metadata.usage = currentStepUsage;
                }
                if (currentStepSpeed && typeof currentStepSpeed === 'object') {
                  Object.assign(metadata, currentStepSpeed);
                  metadata.performance = currentStepSpeed;
                }
                if (hasContentImages) {
                  metadata.isMultimodal = true;
                }
                if (answerSalvagedFromReasoning) {
                  metadata.answerSalvagedFromReasoning = true;
                }

                // Sanitize tool_call `arguments` before persisting to DB so malformed
                // JSON (e.g. Qwen emitting `{, ...}`) can't poison future context
                // builds and 400 strict providers like NVIDIA NIM. See .
                const persistedTools =
                  toolsCalling.length > 0
                    ? toolsCalling.map((t) => ({
                        ...t,
                        arguments: sanitizeToolCallArguments(t.arguments),
                      }))
                    : undefined;

                await ctx.messageModel.update(assistantMessageItem.id, {
                  content: finalContent,
                  imageList: imageList.length > 0 ? imageList : undefined,
                  metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
                  reasoning: finalReasoning,
                  search: grounding,
                  tools: persistedTools,
                });
              } catch (error) {
                console.error('[call_llm] Failed to update message:', error);
              }

              // ===== 2. Then accumulate to AgentState =====
              const newState = structuredClone(state);

              // state.messages flows into the next LLM call payload, so entries
              // must be safe for strict-provider history replay:
              //   - drop tool_calls with empty name (undispatchable, and strict
              //     providers 400 on nameless entries)
              //   - coerce malformed JSON `arguments` to valid JSON
              const sanitizedToolCalls =
                tool_calls.length > 0
                  ? tool_calls
                      .filter((tc) => !!tc.function.name)
                      .map((tc) => ({
                        ...tc,
                        function: {
                          ...tc.function,
                          arguments: sanitizeToolCallArguments(tc.function.arguments),
                        },
                      }))
                  : [];
              const stateToolCalls = sanitizedToolCalls.length > 0 ? sanitizedToolCalls : undefined;

              newState.messages.push({
                content,
                id: assistantMessageItem.id,
                reasoning: replayedReasoning,
                role: 'assistant',
                tool_calls: stateToolCalls,
              });

              if (currentStepUsage) {
                // Use UsageCounter to uniformly accumulate usage and cost
                const { usage, cost } = UsageCounter.accumulateLLM({
                  cost: newState.cost,
                  model: llmPayload.model,
                  modelUsage: currentStepUsage,
                  provider: llmPayload.provider,
                  usage: newState.usage,
                });

                newState.usage = usage;
                if (cost) newState.cost = cost;
              }

              // Propagate stepLabel from instruction to state metadata for hook consumers
              if (stepLabel || visibleOutputEndPublishedStepIndex !== undefined) {
                const stateMetadata = { ...newState.metadata };
                if (stepLabel) stateMetadata._stepLabel = stepLabel;
                if (visibleOutputEndPublishedStepIndex !== undefined) {
                  stateMetadata[VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY] =
                    visibleOutputEndPublishedStepIndex;
                }
                newState.metadata = stateMetadata;
              }

              // Record chat response attributes on the OTel span.
              const usageRecord = currentStepUsage as
                | {
                    inputCachedTokens?: number;
                    outputReasoningTokens?: number;
                    totalInputTokens?: number;
                    totalOutputTokens?: number;
                  }
                | undefined;
              chatSpan.setAttributes(
                buildChatResponseAttributes({
                  cacheReadInputTokens: usageRecord?.inputCachedTokens,
                  finishReasons: currentStepFinishReason ? [currentStepFinishReason] : undefined,
                  inputTokens: usageRecord?.totalInputTokens,
                  outputTokens: usageRecord?.totalOutputTokens,
                  reasoningOutputTokens: usageRecord?.outputReasoningTokens,
                  timeToFirstChunkMs: firstChunkAt,
                }),
              );

              return {
                events,
                newState,
                nextContext: {
                  payload: {
                    hasToolsCalling: toolsCalling.length > 0,
                    // Pass assistant message ID as parentMessageId for tool calls
                    parentMessageId: assistantMessageItem.id,
                    result: { content, tool_calls },
                    toolsCalling,
                  } as GeneralAgentCallLLMResultPayload,
                  phase: 'llm_result' as const,
                  session: {
                    eventCount: events.length,
                    messageCount: newState.messages.length,
                    sessionId: operationId,
                    status: 'running' as const,
                    stepCount: state.stepCount + 1,
                  },
                  stepUsage: currentStepUsage,
                },
              };
            } catch (error) {
              clearAttemptBuffers();

              const classified = classifyLLMError(error);
              const interrupted = await isOperationInterrupted(ctx);

              const retryBudget = resolveLLMRetryBudget(provider, error, SERVER_LLM_RETRY_POLICY);

              if (!interrupted && shouldRetryLLM(classified.kind, attempt, retryBudget)) {
                const delayMs = getLLMRetryDelayMs(attempt);

                log(
                  '[%s] LLM call failed with kind=%s (attempt %d/%d), retrying in %dms ...',
                  operationLogId,
                  classified.kind,
                  attempt,
                  maxAttempts,
                  delayMs,
                );

                const retryEvent: AgentEvent = {
                  data: {
                    attempt: attempt + 1,
                    delayMs,
                    errorType: classified.code,
                    kind: classified.kind,
                    maxAttempts,
                  },
                  type: 'stream_retry',
                };
                events.push(retryEvent);

                await streamManager.publishStreamEvent(operationId, {
                  data: retryEvent.data,
                  stepIndex,
                  type: 'stream_retry',
                });

                await sleep(delayMs);

                if (await isOperationInterrupted(ctx)) {
                  throw error;
                }

                continue;
              }

              if (error instanceof ModelEmptyError && error.diagnostics) {
                error.diagnostics.retryBudget = retryBudget;
                error.diagnostics.retryEvents = events
                  .filter((event) => event.type === 'stream_retry')
                  .map((event) => event.data);
              }

              // Cancel/interrupt path: when the user stops mid-stream, the model-runtime
              // stream is aborted before reaching the post-stream finalize (line ~1078),
              // so the DB row remains a LOADING_FLAT placeholder. Without this fix,
              // agent_runtime_end would push the placeholder as the source-of-truth
              // to the client, clobbering the streamed content accumulated in memory.
              // We persist whatever partial content the stream callbacks already
              // accumulated so that reload/end snapshots reflect actual progress.
              if (interrupted && (content || thinkingContent || toolsCalling.length > 0)) {
                try {
                  const persistedTools =
                    toolsCalling.length > 0
                      ? toolsCalling.map((t) => ({
                          ...t,
                          arguments: sanitizeToolCallArguments(t.arguments),
                        }))
                      : undefined;
                  const interruptedReasoning = thinkingContent
                    ? { content: thinkingContent }
                    : undefined;
                  const interruptedMetadata: Record<string, any> = { interruptedMidStream: true };
                  if (currentStepUsage && typeof currentStepUsage === 'object') {
                    Object.assign(interruptedMetadata, currentStepUsage);
                    interruptedMetadata.usage = currentStepUsage;
                  }
                  if (currentStepSpeed && typeof currentStepSpeed === 'object') {
                    Object.assign(interruptedMetadata, currentStepSpeed);
                    interruptedMetadata.performance = currentStepSpeed;
                  }
                  await ctx.messageModel.update(assistantMessageItem.id, {
                    content,
                    metadata: interruptedMetadata,
                    reasoning: interruptedReasoning,
                    tools: persistedTools,
                  });
                  log(
                    '[%s] Interrupted finalize: persisted partial content (c=%d r=%d tools=%d)',
                    operationLogId,
                    content.length,
                    thinkingContent.length,
                    toolsCalling.length,
                  );
                } catch (persistErr) {
                  log('[%s] Interrupted finalize update failed: %O', operationLogId, persistErr);
                }
              }

              throw error;
            }
          }

          throw new Error('LLM execution retry loop exited unexpectedly');
        });
      } catch (error) {
        chatSpan.recordException(error as Error);
        chatSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        chatSpan.end();
      }
    } catch (error) {
      // Publish error event
      await streamManager.publishStreamEvent(operationId, {
        data: formatErrorEventData(error, 'llm_execution'),
        stepIndex,
        type: 'error',
      });

      console.error(
        `[StreamingLLMExecutor][${operationId}:${stepIndex}] LLM execution failed:`,
        error,
      );
      throw error;
    }
  };
