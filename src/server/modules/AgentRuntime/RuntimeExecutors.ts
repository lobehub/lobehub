import {
  type AgentEvent,
  type AgentInstruction,
  type AgentInstructionCompressContext,
  type AgentState,
  type CallLLMPayload,
  type GeneralAgentCallLLMResultPayload,
  type GeneralAgentCompressionResultPayload,
  type InstructionExecutor,
  UsageCounter,
} from '@lobechat/agent-runtime';
import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import {
  AGENT_DOCUMENT_INJECTION_POSITIONS,
  type AgentContextDocument,
  buildStepSkillDelta,
  buildStepToolDelta,
  type LobeToolManifest,
  type OnboardingContext,
  type OperationToolSet,
  type ResolvedToolSet,
  resolveTopicReferences,
  SkillResolver,
  ToolNameResolver,
  ToolResolver,
} from '@lobechat/context-engine';
import { parse } from '@lobechat/conversation-flow';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import { chainCompressContext } from '@lobechat/prompts';
import { type ChatToolPayload, type MessageToolCall, type UIChatMessage } from '@lobechat/types';
import { serializePartsForStorage } from '@lobechat/utils';
import debug from 'debug';

import { type MessageModel, MessageModel as MessageModelClass } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { type LobeChatDatabase } from '@/database/type';
import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';
import { type EvalContext } from '@/server/modules/Mecha/ContextEngineering/types';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { FileService } from '@/server/services/file';
import { MessageService } from '@/server/services/message';
import { OnboardingService } from '@/server/services/onboarding';
import {
  type ToolExecutionResultResponse,
  type ToolExecutionService,
} from '@/server/services/toolExecution';

import { dispatchClientTool } from './dispatchClientTool';
import { classifyLLMError, type LLMErrorKind } from './llmErrorClassification';
import {
  createConversationParentMissingError,
  isParentMessageMissingError,
  isPersistFatal,
  markPersistFatal,
} from './messagePersistErrors';
import { type IStreamEventManager } from './types';

const log = debug('lobe-server:agent-runtime:streaming-executors');
const timing = debug('lobe-server:agent-runtime:timing');

const VALID_DOCUMENT_POSITIONS = new Set<AgentContextDocument['loadPosition']>(
  AGENT_DOCUMENT_INJECTION_POSITIONS,
);

const normalizeDocumentPosition = (
  position: string | null | undefined,
): AgentContextDocument['loadPosition'] | undefined => {
  if (!position) return undefined;
  return VALID_DOCUMENT_POSITIONS.has(position as AgentContextDocument['loadPosition'])
    ? (position as AgentContextDocument['loadPosition'])
    : undefined;
};

// Tool pricing configuration (USD per call)
const TOOL_PRICING: Record<string, number> = {
  'lobe-web-browsing/craw': 0,
  'lobe-web-browsing/search': 0,
};

const TOOL_MAX_RETRIES = 2;
const LLM_MAX_RETRIES = 5;
const LLM_RETRY_BASE_DELAY_MS = 1000;
const LLM_RETRY_MAX_DELAY_MS = 30_000;

type ToolFailureKind = 'replan' | 'retry' | 'stop';

const getToolFailureKind = (result: ToolExecutionResultResponse): ToolFailureKind | undefined => {
  if (!result.error || typeof result.error !== 'object') return;

  const { kind } = result.error as { kind?: unknown };
  return kind === 'replan' || kind === 'retry' || kind === 'stop' ? kind : undefined;
};

const shouldRetryTool = (kind: ToolFailureKind | undefined, attempt: number, maxRetries: number) =>
  kind === 'retry' && attempt <= maxRetries;

// Builds a postProcessUrl callback that resolves S3 keys in file-backed fields
// (imageList, videoList, fileList) to absolute URLs. Must be passed to every
// messageModel.query() call whose output is later fed to the LLM — otherwise
// the provider layer receives raw keys like `files/user_xxx/icon.png` and
// rejects them (see anthropic contextBuilder `Invalid image URL`).
//
// FileService is constructed lazily so environments without S3 config (unit
// tests) don't fail at context-build time; failure returns undefined, which
// leaves URLs as raw keys — same behavior as before this helper existed.
const buildPostProcessUrl = (ctx: Pick<RuntimeExecutorContext, 'serverDB' | 'userId'>) => {
  if (!ctx.userId || !ctx.serverDB) return undefined;
  let fileService: FileService | undefined;
  try {
    fileService = new FileService(ctx.serverDB, ctx.userId);
  } catch {
    return undefined;
  }
  return (path: string | null) => fileService!.getFullFileUrl(path);
};

const shouldRetryLLM = (kind: LLMErrorKind, attempt: number, maxRetries: number) =>
  kind === 'retry' && attempt <= maxRetries;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getLLMRetryDelayMs = (attempt: number) =>
  Math.min(LLM_RETRY_BASE_DELAY_MS * 2 ** Math.max(attempt - 1, 0), LLM_RETRY_MAX_DELAY_MS);

const isOperationInterrupted = async (ctx: RuntimeExecutorContext) => {
  if (!ctx.loadAgentState) return false;

  try {
    const latestState = await ctx.loadAgentState(ctx.operationId);
    return latestState?.status === 'interrupted';
  } catch (error) {
    console.error('[RuntimeExecutors] Failed to load operation state for retry guard:', error);
    return false;
  }
};

const executeToolWithRetry = async (
  execute: () => Promise<ToolExecutionResultResponse>,
  params: {
    isInterrupted?: () => Promise<boolean>;
    maxRetries: number;
    operationLogId: string;
    toolName: string;
  },
): Promise<{ attempts: number; result: ToolExecutionResultResponse }> => {
  const maxAttempts = params.maxRetries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await execute();

    if (result.success) return { attempts: attempt, result };

    const kind = getToolFailureKind(result);

    if (shouldRetryTool(kind, attempt, params.maxRetries)) {
      if (await params.isInterrupted?.()) {
        return { attempts: attempt, result };
      }

      log(
        '[%s] Tool %s failed with kind=%s (attempt %d/%d), retrying ...',
        params.operationLogId,
        params.toolName,
        kind,
        attempt,
        maxAttempts,
      );
      continue;
    }

    return { attempts: attempt, result };
  }

  throw new Error('Tool execution retry loop exited unexpectedly');
};

const buildToolDiscoveryConfig = (operationToolSet: OperationToolSet, enabledToolIds: string[]) => {
  const enabledToolSet = new Set(enabledToolIds);

  if (!enabledToolSet.has(LobeActivatorIdentifier)) return undefined;

  const availableTools = Object.entries(operationToolSet.manifestMap)
    .filter(([identifier]) => !enabledToolSet.has(identifier))
    .map(([identifier, manifest]) => ({
      description: manifest.meta?.description || '',
      identifier,
      name: manifest.meta?.title || identifier,
    }));

  if (availableTools.length === 0) return undefined;

  return { availableTools };
};

const formatErrorEventData = (error: unknown, phase: string) => {
  let errorMessage = 'Unknown error';
  let errorType: string | undefined;

  if (error && typeof error === 'object') {
    const payload = error as { error?: unknown; errorType?: unknown; message?: unknown };

    if (typeof payload.errorType === 'string') {
      errorType = payload.errorType;
    }

    if (typeof payload.message === 'string' && payload.message.length > 0) {
      errorMessage = payload.message;
    } else if (typeof payload.error === 'string' && payload.error.length > 0) {
      errorMessage = payload.error;
    } else if (
      payload.error &&
      typeof payload.error === 'object' &&
      'message' in payload.error &&
      typeof payload.error.message === 'string'
    ) {
      errorMessage = payload.error.message;
    } else if (error instanceof Error && error.message.length > 0) {
      errorMessage = error.message;
    } else if (errorType) {
      errorMessage = errorType;
    }
  } else if (error instanceof Error && error.message.length > 0) {
    errorMessage = error.message;
    errorType = error.name;
  } else if (typeof error === 'string' && error.length > 0) {
    errorMessage = error;
  }

  if (!errorType && error instanceof Error && error.name) {
    errorType = error.name;
  }

  return {
    error: errorMessage,
    errorType,
    phase,
  };
};

export interface RuntimeExecutorContext {
  agentConfig?: any;
  botPlatformContext?: any;
  discordContext?: any;
  evalContext?: EvalContext;
  loadAgentState?: (operationId: string) => Promise<AgentState | null>;
  messageModel: MessageModel;
  operationId: string;
  serverDB: LobeChatDatabase;
  stepIndex: number;
  stream?: boolean;
  streamManager: IStreamEventManager;
  toolExecutionService: ToolExecutionService;
  topicId?: string;
  userId?: string;
  userTimezone?: string;
}

export const createRuntimeExecutors = (
  ctx: RuntimeExecutorContext,
): Partial<Record<AgentInstruction['type'], InstructionExecutor>> => ({
  /**
   * Create streaming LLM executor
   * Integrates Agent Runtime and stream event publishing
   */
  call_llm: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_llm' }>;
    const llmPayload = payload as CallLLMPayload;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];

    // Fallback to state's modelRuntimeConfig if not in payload
    const model = llmPayload.model || state.modelRuntimeConfig?.model;
    const provider = llmPayload.provider || state.modelRuntimeConfig?.provider;
    // Resolve tools via ToolResolver (unified tool injection)
    const activeDeviceId = state.metadata?.activeDeviceId;
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
    const parentId = llmPayload.parentId || (llmPayload as any).parentMessageId;

    // Parent existence preflight (LOBE-7158 / LOBE-7154):
    // If the parent was deleted concurrently (e.g. user deleted topic mid-run),
    // assistant message creation below would hit a PG FK violation AFTER we've
    // already done the LLM call and spent tokens. Check first — fail fast,
    // save cost, and surface a typed error the frontend can act on instead of
    // a raw SQL error.
    if (parentId) {
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

    if (existingAssistantMessageId) {
      // Use existing assistant message (created by execAgent)
      assistantMessageItem = { id: existingAssistantMessageId };
      log(`${stagePrefix} Using existing assistant message: %s`, existingAssistantMessageId);
    } else {
      // Create new assistant message (legacy behavior)
      assistantMessageItem = await ctx.messageModel.create({
        agentId: state.metadata!.agentId!,
        content: '',
        model,
        parentId,
        provider,
        role: 'assistant',
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      });
      log(`${stagePrefix} Created new assistant message: %s`, assistantMessageItem.id);
    }

    // Publish stream start event
    const stepLabel = (instruction as any).stepLabel;
    await streamManager.publishStreamEvent(operationId, {
      data: {
        assistantMessage: assistantMessageItem,
        model,
        provider,
        ...(stepLabel && { stepLabel }),
      },
      stepIndex,
      type: 'stream_start',
    });

    try {
      type ContentPart = { text: string; type: 'text' } | { image: string; type: 'image' };

      // Process messages through serverMessagesEngine to inject system role, knowledge, etc.
      // Rebuild params from agentConfig at execution time (capabilities built dynamically)
      const agentConfig = ctx.agentConfig;
      let processedMessages;
      if (agentConfig) {
        const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

        // Extract <refer_topic> tags from messages and fetch summaries.
        // Skip if messages already contain injected topic_reference_context
        // (e.g., from client-side contextEngineering preprocessing) to avoid double injection.
        let topicReferences;
        const alreadyHasTopicRefs = (
          llmPayload.messages as Array<{ content: string | unknown }>
        ).some(
          (m) => typeof m.content === 'string' && m.content.includes('topic_reference_context'),
        );

        if (!alreadyHasTopicRefs && ctx.serverDB && ctx.userId) {
          const topicModel = new TopicModel(ctx.serverDB, ctx.userId);
          const messageModel = new MessageModelClass(ctx.serverDB, ctx.userId);
          topicReferences = await resolveTopicReferences(
            llmPayload.messages as Array<{ content: string | unknown }>,
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
            const agentDocService = new AgentDocumentsService(ctx.serverDB, ctx.userId);
            const docs = await agentDocService.getAgentDocuments(agentId);
            if (docs.length > 0) {
              agentDocuments = docs.map((doc) => ({
                content: doc.content,
                description: doc.description ?? undefined,
                filename: doc.filename,
                id: doc.id,
                loadPosition: normalizeDocumentPosition(
                  doc.policy?.context?.position || doc.policyLoadPosition,
                ),
                loadRules: doc.loadRules,
                policyId: doc.templateId,
                policyLoad: doc.policyLoad as 'always' | 'progressive',
                policyLoadFormat: doc.policy?.context?.policyLoadFormat || doc.policyLoadFormat,
                title: doc.title,
              }));
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
          llmPayload.messages as Array<{ content: string | unknown }>
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
            const onboardingState = await onboardingService.getState();
            const phaseGuidance = formatWebOnboardingStateMessage(onboardingState);

            // Fetch SOUL.md from inbox agent's documents
            let soulContent: string | null = null;
            try {
              const inboxAgentId = await onboardingService.getInboxAgentId();
              if (inboxAgentId) {
                const docService = new AgentDocumentsService(ctx.serverDB, ctx.userId);
                const soulDoc = await docService.getDocumentByFilename(inboxAgentId, 'SOUL.md');
                soulContent = soulDoc?.content ?? null;
              }
            } catch (error) {
              log('Failed to fetch SOUL.md for onboarding context: %O', error);
            }

            // Fetch user persona
            let personaContent: string | null = null;
            try {
              const { UserPersonaModel } = await import('@/database/models/userMemory/persona');
              const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);
              const persona = await personaModel.getLatestPersonaDocument();
              personaContent = persona?.persona ?? null;
            } catch (error) {
              log('Failed to fetch user persona for onboarding context: %O', error);
            }

            onboardingContext = { personaContent, phaseGuidance, soulContent };
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
          | { description?: string | null; title?: string | null }
          | undefined;

        let lobehubSkillTopicTitle = '';
        if (lobehubSkillTopicId && ctx.serverDB && ctx.userId) {
          try {
            const topicModelForLobehub = new TopicModel(ctx.serverDB, ctx.userId);
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

        const contextEngineInput = {
          agentDocuments,
          additionalVariables: {
            ...state.metadata?.deviceSystemInfo,
            ...lobehubSkillVariables,
          },
          userTimezone: ctx.userTimezone,
          capabilities: {
            isCanUseFC: (m: string, p: string) => {
              const info = LOBE_DEFAULT_MODEL_LIST.find(
                (item) => item.id === m && item.providerId === p,
              );
              return info?.abilities?.functionCall ?? true;
            },
            isCanUseVideo: (m: string, p: string) => {
              const info = LOBE_DEFAULT_MODEL_LIST.find(
                (item) => item.id === m && item.providerId === p,
              );
              return info?.abilities?.video ?? false;
            },
            isCanUseVision: (m: string, p: string) => {
              const info = LOBE_DEFAULT_MODEL_LIST.find(
                (item) => item.id === m && item.providerId === p,
              );
              return info?.abilities?.vision ?? true;
            },
          },
          botPlatformContext: ctx.botPlatformContext,
          discordContext: ctx.discordContext,
          enableHistoryCount: agentConfig.chatConfig?.enableHistoryCount ?? undefined,
          evalContext: ctx.evalContext,
          forceFinish: state.forceFinish,
          historyCount: agentConfig.chatConfig?.historyCount ?? undefined,
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
          messages: llmPayload.messages as UIChatMessage[],
          model,
          provider,
          systemRole: agentConfig.systemRole ?? undefined,
          toolDiscoveryConfig,
          toolsConfig: {
            manifests: Object.values(resolved.manifestMap),
            tools: resolved.enabledToolIds,
          },
          userMemory: state.metadata?.userMemory,

          // Skills configuration for <available_skills> injection
          ...(resolvedSkills?.enabledSkills?.length && {
            skillsConfig: { enabledSkills: resolvedSkills.enabledSkills },
          }),

          // Topic reference summaries
          ...(topicReferences && { topicReferences }),
          ...(onboardingContext && { onboardingContext }),
        };

        processedMessages = await serverMessagesEngine(contextEngineInput);

        // Emit context engine event for tracing
        // Omit large/redundant fields to reduce snapshot size:
        // - input.messages: reconstructible from step's messagesBaseline + messagesDelta
        // - input.toolsConfig: static per operation, ~47KB of manifests repeated every call_llm step
        // Keep output (processedMessages) — needed by inspect CLI for --env, --system-role, -m
        const {
          messages: _inputMsgs,
          toolsConfig: _toolsConfig,
          ...contextEngineInputLite
        } = contextEngineInput;
        events.push({
          input: {
            ...contextEngineInputLite,
            toolCount: _toolsConfig?.tools?.length ?? 0,
          },
          output: processedMessages,
          type: 'context_engine_result',
        } as any);
      } else {
        processedMessages = llmPayload.messages;
      }

      // Initialize ModelRuntime (read user's keyVaults from database)
      const modelRuntime = await initModelRuntimeFromDB(ctx.serverDB, ctx.userId!, provider);

      // Construct ChatStreamPayload
      const stream = ctx.stream ?? true;
      const chatPayload = { messages: processedMessages, model, stream, tools };

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

      const maxAttempts = LLM_MAX_RETRIES + 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let content = '';
        let toolsCalling: ChatToolPayload[] = [];
        let tool_calls: MessageToolCall[] = [];
        let thinkingContent = '';
        const imageList: any[] = [];
        let grounding: any = null;
        let currentStepUsage: any = undefined;
        let streamError: any = undefined;
        const contentParts: ContentPart[] = [];
        const reasoningParts: ContentPart[] = [];
        const hasContentImages = false;
        const hasReasoningImages = false;
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
              onToolsCalling: async ({ toolsCalling: raw }) => {
                const resolvedCalls = new ToolNameResolver().resolve(raw, resolved.manifestMap);
                // Attach source (origin) and executor (dispatch target) for routing
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
            result: { content, reasoning: thinkingContent, tool_calls, usage: currentStepUsage },
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

          log('[%s:%d] call_llm completed', operationId, stepIndex);

          // ===== 1. First save original usage to message.metadata =====
          // Determine final content - use serialized parts if has images, otherwise plain text
          const finalContent = hasContentImages ? serializePartsForStorage(contentParts) : content;

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

          try {
            // Build metadata object
            const metadata: Record<string, any> = {};
            if (currentStepUsage && typeof currentStepUsage === 'object') {
              Object.assign(metadata, currentStepUsage);
            }
            if (hasContentImages) {
              metadata.isMultimodal = true;
            }

            await ctx.messageModel.update(assistantMessageItem.id, {
              content: finalContent,
              imageList: imageList.length > 0 ? imageList : undefined,
              metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
              reasoning: finalReasoning,
              search: grounding,
              tools: toolsCalling.length > 0 ? toolsCalling : undefined,
            });
          } catch (error) {
            console.error('[call_llm] Failed to update message:', error);
          }

          // ===== 2. Then accumulate to AgentState =====
          const newState = structuredClone(state);

          // Carry the persisted DB id so downstream executors (notably
          // `request_human_approve`) can look up the parent assistant from
          // `state.messages` without an extra DB round-trip. Without the id
          // the lookup at `request_human_approve` (which filters on `m.id`)
          // falls through to a DB query; when human-approve fires on the
          // fresh LLM turn, both code paths miss and the op errors with
          // "No assistant message found as parent for pending tool messages".
          newState.messages.push({
            content,
            id: assistantMessageItem.id,
            reasoning: finalReasoning,
            role: 'assistant',
            tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
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
          if (stepLabel) {
            if (!newState.metadata) newState.metadata = {};
            newState.metadata._stepLabel = stepLabel;
          }

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
              phase: 'llm_result',
              session: {
                eventCount: events.length,
                messageCount: newState.messages.length,
                sessionId: operationId,
                status: 'running',
                stepCount: state.stepCount + 1,
              },
              stepUsage: currentStepUsage,
            },
          };
        } catch (error) {
          clearAttemptBuffers();

          const classified = classifyLLMError(error);
          const interrupted = await isOperationInterrupted(ctx);

          if (!interrupted && shouldRetryLLM(classified.kind, attempt, LLM_MAX_RETRIES)) {
            const delayMs = getLLMRetryDelayMs(attempt);

            log(
              '[%s] LLM call failed with kind=%s (attempt %d/%d), retrying in %dms ...',
              operationLogId,
              classified.kind,
              attempt,
              maxAttempts,
              delayMs,
            );

            await streamManager.publishStreamEvent(operationId, {
              data: { attempt: attempt + 1, delayMs, maxAttempts },
              stepIndex,
              type: 'stream_retry',
            });

            await sleep(delayMs);

            if (await isOperationInterrupted(ctx)) {
              throw error;
            }

            continue;
          }

          throw error;
        }
      }

      throw new Error('LLM execution retry loop exited unexpectedly');
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
  },

  compress_context: async (instruction, state) => {
    const { payload } = instruction as AgentInstructionCompressContext;
    const { messages, currentTokenCount } = payload;
    const { operationId, stepIndex } = ctx;
    const operationLogId = `${operationId}:${stepIndex}`;
    const stagePrefix = `[${operationLogId}][compress_context]`;
    const events: AgentEvent[] = [];
    const newState = structuredClone(state);
    const topicId = state.metadata?.topicId;
    const lastMessage = messages.at(-1);
    const preservedMessages =
      messages.length > 1 && lastMessage?.role === 'user' ? [lastMessage] : [];
    const preservedMessageIds = new Set(
      preservedMessages.map((message) => message.id).filter((id): id is string => Boolean(id)),
    );
    const messagesToCompress = preservedMessages.length > 0 ? messages.slice(0, -1) : messages;
    const compressedMessagesFallback = [...messagesToCompress, ...preservedMessages];

    if (!topicId || !ctx.userId) {
      return {
        events,
        newState,
        nextContext: {
          payload: {
            compressedMessages: compressedMessagesFallback,
            groupId: '',
            parentMessageId: undefined,
            skipped: true,
          } as GeneralAgentCompressionResultPayload,
          phase: 'compression_result',
          session: {
            messageCount: newState.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        },
      };
    }

    try {
      const dbMessages = await ctx.messageModel.query(
        {
          agentId: state.metadata?.agentId,
          threadId: state.metadata?.threadId,
          topicId,
        },
        { postProcessUrl: buildPostProcessUrl(ctx) },
      );

      const messageIds = dbMessages
        .filter(
          (message) =>
            message.role !== 'compressedGroup' &&
            Boolean(message.id) &&
            !preservedMessageIds.has(message.id),
        )
        .map((message) => message.id);

      if (messageIds.length === 0 || messagesToCompress.length === 0) {
        return {
          events,
          newState,
          nextContext: {
            payload: {
              compressedMessages: compressedMessagesFallback,
              groupId: '',
              parentMessageId: undefined,
              skipped: true,
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: newState.messages.length,
              sessionId: operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          },
        };
      }

      const latestAssistantMessage = dbMessages.findLast((message) => message.role === 'assistant');
      const messageService = new MessageService(ctx.serverDB, ctx.userId);
      const compressionResult = await messageService.createCompressionGroup(topicId, messageIds, {
        agentId: state.metadata?.agentId,
        threadId: state.metadata?.threadId,
        topicId,
      });

      const compressionModel =
        newState.modelRuntimeConfig?.compressionModel || newState.modelRuntimeConfig;

      if (!compressionModel?.model || !compressionModel?.provider) {
        return {
          events,
          newState,
          nextContext: {
            payload: {
              compressedMessages: compressedMessagesFallback,
              groupId: '',
              parentMessageId: latestAssistantMessage?.id,
              skipped: true,
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: newState.messages.length,
              sessionId: operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          },
        };
      }

      const compressionPayload = chainCompressContext(compressionResult.messagesToSummarize);
      const compressionRuntime = await initModelRuntimeFromDB(
        ctx.serverDB,
        ctx.userId,
        compressionModel.provider,
      );

      let summaryContent = '';
      let summaryUsage: any;
      let summaryError: any;

      const compressionResponse = await compressionRuntime.chat(
        {
          messages: compressionPayload.messages!,
          model: compressionModel.model,
          stream: true,
        },
        {
          callback: {
            onCompletion: async (data) => {
              if (data.usage) summaryUsage = data.usage;
            },
            onError: async (errorData) => {
              summaryError = errorData;
            },
            onText: async (text) => {
              summaryContent += text;
            },
          },
          user: ctx.userId,
        },
      );

      await consumeStreamUntilDone(compressionResponse);

      if (summaryError) {
        throw new Error(
          typeof summaryError.message === 'string'
            ? summaryError.message
            : JSON.stringify(summaryError),
        );
      }

      const finalCompression = await messageService.finalizeCompression(
        compressionResult.messageGroupId,
        summaryContent,
        {
          agentId: state.metadata?.agentId,
          threadId: state.metadata?.threadId,
          topicId,
        },
      );

      const compressedMessagesBase =
        finalCompression.messages || compressionResult.messagesToSummarize;
      const compressedMessages = [...compressedMessagesBase];

      for (const preservedMessage of preservedMessages) {
        if (
          !compressedMessages.some(
            (message) =>
              message === preservedMessage ||
              (Boolean(message.id) &&
                Boolean(preservedMessage.id) &&
                message.id === preservedMessage.id),
          )
        ) {
          compressedMessages.push(preservedMessage);
        }
      }

      newState.messages = compressedMessages;

      if (summaryUsage) {
        const { usage, cost } = UsageCounter.accumulateLLM({
          cost: newState.cost,
          model: compressionModel.model,
          modelUsage: summaryUsage,
          provider: compressionModel.provider,
          usage: newState.usage,
        });

        newState.usage = usage;
        if (cost) newState.cost = cost;
      }

      events.push({
        groupId: compressionResult.messageGroupId,
        parentMessageId: latestAssistantMessage?.id,
        type: 'compression_complete',
      });

      return {
        events,
        newState,
        nextContext: {
          payload: {
            compressedMessages,
            groupId: compressionResult.messageGroupId,
            parentMessageId: latestAssistantMessage?.id,
          } as GeneralAgentCompressionResultPayload,
          phase: 'compression_result',
          session: {
            messageCount: compressedMessages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        },
      };
    } catch (error) {
      log(
        `${stagePrefix} Compression failed. originalTokens=%d error=%O`,
        currentTokenCount,
        error,
      );

      events.push({ error, type: 'compression_error' });

      return {
        events,
        newState,
        nextContext: {
          payload: {
            compressedMessages: compressedMessagesFallback,
            groupId: '',
            parentMessageId: undefined,
            skipped: true,
          } as GeneralAgentCompressionResultPayload,
          phase: 'compression_result',
          session: {
            messageCount: newState.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        },
      };
    }
  },
  /**
   * Tool execution
   */
  call_tool: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tool' }>;
    const { operationId, stepIndex, streamManager, toolExecutionService } = ctx;
    const events: AgentEvent[] = [];

    const operationLogId = `${operationId}:${stepIndex}`;
    log(`[${operationLogId}] payload: %O`, payload);

    // Publish tool execution start event
    await streamManager.publishStreamEvent(operationId, {
      data: payload,
      stepIndex,
      type: 'tool_start',
    });

    try {
      // payload is { parentMessageId, toolCalling: ChatToolPayload }
      const chatToolPayload: ChatToolPayload = payload.toolCalling;

      const toolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;

      // Check if this is a client-side function tool — pause instead of executing
      const toolSource =
        state.operationToolSet?.sourceMap?.[chatToolPayload.identifier] ??
        state.toolSourceMap?.[chatToolPayload.identifier];

      if (toolSource === 'client') {
        log(`[${operationLogId}] Client function tool detected: ${toolName}, pausing for client`);

        // Publish tool call info so streaming can emit function_call events
        await streamManager.publishStreamChunk(operationId, stepIndex, {
          chunkType: 'tools_calling',
          toolsCalling: [chatToolPayload] as any,
        });

        const newState = structuredClone(state);
        newState.lastModified = new Date().toISOString();
        newState.status = 'interrupted';
        newState.interruption = {
          canResume: true,
          interruptedAt: new Date().toISOString(),
          interruptedInstruction: instruction,
          reason: 'client_tool_execution',
        };
        newState.pendingToolsCalling = [chatToolPayload];

        return {
          events: [
            {
              canResume: true,
              interruptedAt: new Date().toISOString(),
              reason: 'client_tool_execution',
              type: 'interrupted',
            },
          ],
          newState,
          // No nextContext — loop stops, waiting for client to provide tool result
        };
      }

      // Extract toolResultMaxLength from agent config
      const agentConfig = state.metadata?.agentConfig;
      const toolResultMaxLength = agentConfig?.chatConfig?.toolResultMaxLength;

      // Build effective manifest map (operation + step-level activations)
      const effectiveManifestMap = {
        ...(state.operationToolSet?.manifestMap ?? state.toolManifestMap),
        ...Object.fromEntries(
          (state.activatedStepTools ?? [])
            .filter((a) => a.manifest)
            .map((a) => [a.id, a.manifest!]),
        ),
      };

      // Route to client via Agent Gateway WS when the tool is marked
      // executor='client' and the current stream manager can reach a gateway.
      // Falls through to the normal server path if either is unavailable.
      const canDispatchToClient =
        chatToolPayload.executor === 'client' &&
        typeof streamManager.sendToolExecute === 'function';

      let execution: { result: ToolExecutionResultResponse; attempts: number };
      if (canDispatchToClient) {
        log(`[${operationLogId}] Dispatching tool ${toolName} to client via Agent Gateway`);
        const dispatchResult = await dispatchClientTool(chatToolPayload, {
          operationId,
          streamManager,
        });
        execution = { attempts: 1, result: dispatchResult };
      } else {
        // Inject source from sourceMap so BuiltinToolsExecutor can route
        // lobehubSkill / klavis tools correctly (LLM responses don't carry source)
        if (toolSource && !chatToolPayload.source) {
          chatToolPayload.source = toolSource;
        }

        // Execute tool using ToolExecutionService
        log(`[${operationLogId}] Executing tool ${toolName} ...`);
        execution = await executeToolWithRetry(
          () =>
            toolExecutionService.executeTool(chatToolPayload, {
              activeDeviceId: state.metadata?.activeDeviceId,
              agentId: state.metadata?.agentId,
              memoryToolPermission: agentConfig?.chatConfig?.memory?.toolPermission,
              serverDB: ctx.serverDB,
              taskId: state.metadata?.taskId,
              toolManifestMap: effectiveManifestMap,
              toolResultMaxLength,
              topicId: ctx.topicId,
              userId: ctx.userId,
            }),
          {
            isInterrupted: () => isOperationInterrupted(ctx),
            maxRetries: TOOL_MAX_RETRIES,
            operationLogId,
            toolName,
          },
        );
      }

      const executionResult = execution.result;
      const executionTime = executionResult.executionTime;
      const isSuccess = executionResult.success;
      log(
        `[${operationLogId}] Executing ${toolName} in ${executionTime}ms, result: %O`,
        executionResult,
      );

      // Publish tool execution result event
      await streamManager.publishStreamEvent(operationId, {
        data: {
          executionTime,
          isSuccess,
          attempts: execution.attempts,
          maxAttempts: TOOL_MAX_RETRIES + 1,
          payload,
          phase: 'tool_execution',
          result: executionResult,
        },
        stepIndex,
        type: 'tool_end',
      });

      // Finally persist to database. In resumption mode (skipCreateToolMessage),
      // the pending tool message already exists from request_human_approve, so
      // we update it in-place rather than inserting a new row — inserting would
      // either duplicate the tool_call_id or violate parent_id FK (LOBE-7154).
      let toolMessageId: string | undefined;
      try {
        if (payload.skipCreateToolMessage) {
          toolMessageId = payload.parentMessageId;
          await ctx.messageModel.updateToolMessage(toolMessageId, {
            content: executionResult.content,
            metadata: { toolExecutionTimeMs: executionTime },
            pluginError: executionResult.error,
            pluginState: executionResult.state,
          });
          log(
            '[%s:%d] Updated existing tool message %s (skipCreateToolMessage)',
            operationId,
            stepIndex,
            toolMessageId,
          );
        } else {
          const toolMessage = await ctx.messageModel.create({
            agentId: state.metadata!.agentId!,
            content: executionResult.content,
            metadata: { toolExecutionTimeMs: executionTime },
            parentId: payload.parentMessageId,
            plugin: chatToolPayload as any,
            pluginError: executionResult.error,
            pluginState: executionResult.state,
            role: 'tool',
            threadId: state.metadata?.threadId,
            tool_call_id: chatToolPayload.id,
            topicId: state.metadata?.topicId,
          });
          toolMessageId = toolMessage.id;
        }
      } catch (error) {
        console.error('[StreamingToolExecutor] Failed to persist tool message: %O', error);
        // Normalize BEFORE publishing so clients (which treat `error` stream
        // events as terminal and surface `event.data.error` directly) see the
        // typed business error, not the raw SQL / driver text.
        const fatal = isParentMessageMissingError(error)
          ? createConversationParentMissingError(payload.parentMessageId, error)
          : error instanceof Error
            ? error
            : new Error(String(error));
        await streamManager.publishStreamEvent(operationId, {
          data: formatErrorEventData(fatal, 'tool_message_persist'),
          stepIndex,
          type: 'error',
        });
        // Mark so the outer catch (which normally converts tool-exec errors
        // into event records and returns the unchanged state) re-throws.
        throw markPersistFatal(fatal);
      }

      const newState = structuredClone(state);

      newState.messages.push({
        content: executionResult.content,
        role: 'tool',
        tool_call_id: chatToolPayload.id,
      });

      events.push({ id: chatToolPayload.id, result: executionResult, type: 'tool_result' });

      // Get tool unit price
      const toolCost = TOOL_PRICING[toolName] || 0;

      // Use UsageCounter to uniformly accumulate tool usage
      const { usage, cost } = UsageCounter.accumulateTool({
        cost: newState.cost,
        executionTime,
        success: isSuccess,
        toolCost,
        toolName,
        usage: newState.usage,
      });

      newState.usage = usage;
      if (cost) newState.cost = cost;

      // Persist ToolsActivator discovery results to state.activatedStepTools
      const discoveredTools = executionResult.state?.activatedTools as
        | Array<{ identifier: string }>
        | undefined;
      if (discoveredTools?.length) {
        const existingIds = new Set(
          (newState.activatedStepTools ?? []).map((t: { id: string }) => t.id),
        );
        const newActivations = discoveredTools
          .filter((t) => !existingIds.has(t.identifier))
          .map((t) => ({
            activatedAtStep: state.stepCount,
            id: t.identifier,
            manifest: effectiveManifestMap[t.identifier],
            source: 'discovery' as const,
          }));

        if (newActivations.length > 0) {
          newState.activatedStepTools = [...(newState.activatedStepTools ?? []), ...newActivations];

          log(
            `[${operationLogId}] Persisted %d tool activations to state: %o`,
            newActivations.length,
            newActivations.map((a) => a.id),
          );
        }
      }

      // Find current tool statistics
      const currentToolStats = usage.tools.byTool.find((t) => t.name === toolName);

      // Log usage information
      log(
        `[${operationLogId}][tool usage] %s: calls=%d, time=%dms, success=%s, cost=$%s`,
        toolName,
        currentToolStats?.calls || 0,
        executionTime,
        isSuccess,
        toolCost.toFixed(4),
      );

      log('[%s:%d] Tool execution completed', operationId, stepIndex);

      return {
        events,
        newState,
        nextContext: {
          payload: {
            data: executionResult,
            executionTime,
            isSuccess,
            // Pass tool message ID as parentMessageId for the next LLM call
            parentMessageId: toolMessageId,
            toolCall: chatToolPayload,
            toolCallId: chatToolPayload.id,
          },
          phase: 'tool_result',
          session: {
            eventCount: events.length,
            messageCount: newState.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
          stepUsage: {
            cost: toolCost,
            toolName,
            unitPrice: toolCost,
            usageCount: 1,
          },
        },
      };
    } catch (error) {
      // Persist-level failures (parent FK violation etc.) must propagate so
      // the step fails — otherwise the swallow-and-continue path keeps
      // running the agent on a broken conversation chain. See LOBE-7158.
      if (isPersistFatal(error)) throw error;

      // Publish tool execution error event
      await streamManager.publishStreamEvent(operationId, {
        data: formatErrorEventData(error, 'tool_execution'),
        stepIndex,
        type: 'error',
      });

      events.push({ error, type: 'error' });

      console.error(
        `[StreamingToolExecutor] Tool execution failed for operation ${operationId}:${stepIndex}:`,
        error,
      );

      return {
        events,
        newState: state, // State unchanged
      };
    }
  },

  /**
   * Batch tool execution with database sync
   * Executes multiple tools concurrently and refreshes messages from database after completion
   */
  call_tools_batch: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tools_batch' }>;
    const { parentMessageId, toolsCalling } = payload;
    const { operationId, stepIndex, streamManager, toolExecutionService } = ctx;
    const events: AgentEvent[] = [];

    const operationLogId = `${operationId}:${stepIndex}`;
    log(
      `[${operationLogId}][call_tools_batch] Starting batch execution for ${toolsCalling.length} tools`,
    );

    // Split client vs server tools
    const clientTools: ChatToolPayload[] = [];
    const serverTools: ChatToolPayload[] = [];
    for (const tp of toolsCalling) {
      const src =
        state.operationToolSet?.sourceMap?.[tp.identifier] ?? state.toolSourceMap?.[tp.identifier];
      if (src === 'client') {
        clientTools.push(tp);
      } else {
        serverTools.push(tp);
      }
    }

    // If all tools are client-side, pause immediately
    if (clientTools.length > 0 && serverTools.length === 0) {
      log(
        `[${operationLogId}][call_tools_batch] All ${clientTools.length} tools are client-side, pausing`,
      );

      await streamManager.publishStreamChunk(operationId, stepIndex, {
        chunkType: 'tools_calling',
        toolsCalling: clientTools as any,
      });

      const newState = structuredClone(state);
      newState.lastModified = new Date().toISOString();
      newState.status = 'interrupted';
      newState.interruption = {
        canResume: true,
        interruptedAt: new Date().toISOString(),
        reason: 'client_tool_execution',
      };
      newState.pendingToolsCalling = clientTools;

      return {
        events: [
          {
            canResume: true,
            interruptedAt: new Date().toISOString(),
            reason: 'client_tool_execution',
            type: 'interrupted',
          },
        ],
        newState,
      };
    }

    // Track all tool message IDs created during execution
    const toolMessageIds: string[] = [];
    const toolResults: any[] = [];

    // Execute server tools concurrently (skip client tools in mixed batch)
    const toolsToExecute = serverTools.length > 0 ? serverTools : toolsCalling;
    await Promise.all(
      toolsToExecute.map(async (chatToolPayload: ChatToolPayload) => {
        const toolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;

        // Publish tool execution start event
        await streamManager.publishStreamEvent(operationId, {
          data: { parentMessageId, toolCalling: chatToolPayload },
          stepIndex,
          type: 'tool_start',
        });

        try {
          log(`[${operationLogId}] Executing tool ${toolName} ...`);
          // Build effective manifest map (operation + step-level activations)
          const batchManifestMap = {
            ...(state.operationToolSet?.manifestMap ?? state.toolManifestMap),
            ...Object.fromEntries(
              (state.activatedStepTools ?? [])
                .filter((a) => a.manifest)
                .map((a) => [a.id, a.manifest!]),
            ),
          };

          const batchAgentConfig = state.metadata?.agentConfig;

          const canDispatchToClient =
            chatToolPayload.executor === 'client' &&
            typeof streamManager.sendToolExecute === 'function';

          let execution: { result: ToolExecutionResultResponse; attempts: number };
          if (canDispatchToClient) {
            log(`[${operationLogId}] Dispatching tool ${toolName} to client via Agent Gateway`);
            const dispatchResult = await dispatchClientTool(chatToolPayload, {
              operationId,
              streamManager,
            });
            execution = { attempts: 1, result: dispatchResult };
          } else {
            // Inject source from sourceMap so BuiltinToolsExecutor can route
            // lobehubSkill / klavis tools correctly (LLM responses don't carry source)
            const batchToolSource =
              state.operationToolSet?.sourceMap?.[chatToolPayload.identifier] ??
              state.toolSourceMap?.[chatToolPayload.identifier];
            if (batchToolSource && !chatToolPayload.source) {
              chatToolPayload.source = batchToolSource;
            }

            execution = await executeToolWithRetry(
              () =>
                toolExecutionService.executeTool(chatToolPayload, {
                  activeDeviceId: state.metadata?.activeDeviceId,
                  agentId: state.metadata?.agentId,
                  memoryToolPermission: batchAgentConfig?.chatConfig?.memory?.toolPermission,
                  serverDB: ctx.serverDB,
                  taskId: state.metadata?.taskId,
                  toolManifestMap: batchManifestMap,
                  toolResultMaxLength: batchAgentConfig?.chatConfig?.toolResultMaxLength,
                  topicId: ctx.topicId,
                  userId: ctx.userId,
                }),
              {
                isInterrupted: () => isOperationInterrupted(ctx),
                maxRetries: TOOL_MAX_RETRIES,
                operationLogId,
                toolName,
              },
            );
          }

          const executionResult = execution.result;
          const executionTime = executionResult.executionTime;
          const isSuccess = executionResult.success;
          log(
            `[${operationLogId}] Executed ${toolName} in ${executionTime}ms, success: ${isSuccess}`,
          );

          // Publish tool execution result event
          await streamManager.publishStreamEvent(operationId, {
            data: {
              executionTime,
              isSuccess,
              attempts: execution.attempts,
              maxAttempts: TOOL_MAX_RETRIES + 1,
              payload: { parentMessageId, toolCalling: chatToolPayload },
              phase: 'tool_execution',
              result: executionResult,
            },
            stepIndex,
            type: 'tool_end',
          });

          // Create tool message in database
          try {
            const toolMessage = await ctx.messageModel.create({
              agentId: state.metadata!.agentId!,
              content: executionResult.content,
              metadata: { toolExecutionTimeMs: executionTime },
              parentId: parentMessageId,
              plugin: chatToolPayload as any,
              pluginError: executionResult.error,
              pluginState: executionResult.state,
              role: 'tool',
              threadId: state.metadata?.threadId,
              tool_call_id: chatToolPayload.id,
              topicId: state.metadata?.topicId,
            });
            toolMessageIds.push(toolMessage.id);
            log(`[${operationLogId}] Created tool message ${toolMessage.id} for ${toolName}`);
          } catch (error) {
            console.error(
              `[${operationLogId}] Failed to create tool message for ${toolName}:`,
              error,
            );
            // Normalize BEFORE publishing — clients treat `error` stream
            // events as terminal and surface `event.data.error` directly, so
            // a raw SQL error here would leak driver text to the user before
            // the ConversationParentMissing throw is consumed. See LOBE-7158.
            const fatal = isParentMessageMissingError(error)
              ? createConversationParentMissingError(parentMessageId, error)
              : error instanceof Error
                ? error
                : new Error(String(error));
            await streamManager.publishStreamEvent(operationId, {
              data: formatErrorEventData(fatal, 'tool_message_persist'),
              stepIndex,
              type: 'error',
            });
            // Marker so the outer catch (which normally just records
            // per-tool exec errors) knows to propagate this one.
            throw markPersistFatal(fatal);
          }

          // Collect tool result
          toolResults.push({
            data: executionResult,
            executionTime,
            isSuccess,
            toolCall: chatToolPayload,
            toolCallId: chatToolPayload.id,
          });

          events.push({ id: chatToolPayload.id, result: executionResult, type: 'tool_result' });

          // Collect per-tool usage for post-batch accumulation
          const toolCost = TOOL_PRICING[toolName] || 0;
          toolResults.at(-1).usageParams = {
            executionTime,
            success: isSuccess,
            toolCost,
            toolName,
          };
        } catch (error) {
          // Persist-level failures (e.g. parent FK violations) must propagate
          // so the whole batch short-circuits. Without this the fallback to
          // the already-deleted parent triggers another FK on the next step.
          if (isPersistFatal(error)) {
            throw error;
          }

          console.error(`[${operationLogId}] Tool execution failed for ${toolName}:`, error);

          // Publish error event
          await streamManager.publishStreamEvent(operationId, {
            data: formatErrorEventData(error, 'tool_execution'),
            stepIndex,
            type: 'error',
          });

          events.push({ error, type: 'error' });
        }
      }),
    );

    log(
      `[${operationLogId}][call_tools_batch] All tools executed, created ${toolMessageIds.length} tool messages`,
    );

    // Accumulate tool usage sequentially after all tools have finished
    const newState = structuredClone(state);
    for (const result of toolResults) {
      if (result.usageParams) {
        const { usage, cost } = UsageCounter.accumulateTool({
          ...result.usageParams,
          cost: newState.cost,
          usage: newState.usage,
        });
        newState.usage = usage;
        if (cost) newState.cost = cost;
      }
    }

    // Persist ToolsActivator discovery results from batch tool executions
    const batchEffectiveManifestMap = {
      ...(state.operationToolSet?.manifestMap ?? state.toolManifestMap),
      ...Object.fromEntries(
        (state.activatedStepTools ?? []).filter((a) => a.manifest).map((a) => [a.id, a.manifest!]),
      ),
    };
    const existingActivationIds = new Set(
      (newState.activatedStepTools ?? []).map((t: { id: string }) => t.id),
    );
    for (const result of toolResults) {
      const discovered = result.data?.state?.activatedTools as
        | Array<{ identifier: string }>
        | undefined;
      if (discovered?.length) {
        const newActivations = discovered
          .filter((t) => !existingActivationIds.has(t.identifier))
          .map((t) => ({
            activatedAtStep: state.stepCount,
            id: t.identifier,
            manifest: batchEffectiveManifestMap[t.identifier],
            source: 'discovery' as const,
          }));

        for (const activation of newActivations) {
          existingActivationIds.add(activation.id);
        }

        if (newActivations.length > 0) {
          newState.activatedStepTools = [...(newState.activatedStepTools ?? []), ...newActivations];
        }
      }
    }

    // Refresh messages from database to ensure state is in sync

    // Query latest messages from database
    // Must pass agentId to ensure correct query scope, otherwise when topicId is undefined,
    // the query will use isNull(topicId) condition which won't find messages with actual topicId
    //
    // postProcessUrl resolves S3 keys in imageList/videoList/fileList to absolute URLs;
    // without it the next LLM call sees raw keys and providers reject them.
    const latestMessages = await ctx.messageModel.query(
      {
        agentId: state.metadata?.agentId,
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      },
      { postProcessUrl: buildPostProcessUrl(ctx) },
    );

    // Use conversation-flow parse to resolve branching into linear flat list
    // parse() handles assistantGroup, compare, supervisor, etc. virtual message types
    const { flatList } = parse(latestMessages);
    newState.messages = flatList;

    log(
      `[${operationLogId}][call_tools_batch] Refreshed ${newState.messages.length} messages from database`,
    );

    // Get the last tool message ID as parentMessageId for next LLM call
    const lastToolMessageId = toolMessageIds.at(-1);

    // If there are remaining client tools in a mixed batch, interrupt after server tools
    if (clientTools.length > 0) {
      log(
        `[${operationLogId}][call_tools_batch] Mixed batch: ${serverTools.length} server tools done, pausing for ${clientTools.length} client tools`,
      );

      await streamManager.publishStreamChunk(operationId, stepIndex, {
        chunkType: 'tools_calling',
        toolsCalling: clientTools as any,
      });

      newState.status = 'interrupted';
      newState.interruption = {
        canResume: true,
        interruptedAt: new Date().toISOString(),
        reason: 'client_tool_execution',
      };
      newState.pendingToolsCalling = clientTools;

      return {
        events: [
          ...events,
          {
            canResume: true,
            interruptedAt: new Date().toISOString(),
            reason: 'client_tool_execution',
            type: 'interrupted',
          },
        ],
        newState,
      };
    }

    return {
      events,
      newState,
      nextContext: {
        payload: {
          parentMessageId: lastToolMessageId ?? parentMessageId,
          toolCount: toolsCalling.length,
          toolResults,
        },
        phase: 'tools_batch_result',
        session: {
          eventCount: events.length,
          messageCount: newState.messages.length,
          sessionId: operationId,
          status: 'running',
          stepCount: state.stepCount + 1,
        },
      },
    };
  },

  /**
   * Complete runtime execution
   */
  finish: async (instruction, state) => {
    const { reason, reasonDetail } = instruction as Extract<AgentInstruction, { type: 'finish' }>;
    const { operationId, stepIndex, streamManager } = ctx;

    log('[%s:%d] Finishing execution: (%s)', operationId, stepIndex, reason);

    // Clear runningOperation from topic metadata so reconnect doesn't trigger after completion
    if (ctx.topicId && ctx.userId) {
      try {
        const topicModel = new TopicModel(ctx.serverDB, ctx.userId);
        await topicModel.updateMetadata(ctx.topicId, { runningOperation: null });
      } catch (e) {
        log('[%s] Failed to clear runningOperation metadata: %O', operationId, e);
      }
    }

    // Publish execution complete event
    await streamManager.publishStreamEvent(operationId, {
      data: {
        finalState: { ...state, status: 'done' },
        phase: 'execution_complete',
        reason,
        reasonDetail,
      },
      stepIndex,
      type: 'step_complete',
    });

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.status = 'done';

    const events: AgentEvent[] = [
      {
        finalState: newState,
        reason,
        reasonDetail,
        type: 'done',
      },
    ];

    return { events, newState };
  },

  /**
   * Human approval
   *
   * Mirrors the client executor (`createAgentExecutors.ts:1072-1177`):
   * - Creates one `role='tool'` message per pending tool call with
   *   `pluginIntervention: { status: 'pending' }` so approval UI has a target.
   * - When `skipCreateToolMessage` is true (resumption via `/run` after a
   *   previous op already persisted them), skip creation.
   * - Publishes the `toolCallId -> toolMessageId` mapping alongside the
   *   `tools_calling` stream chunk so the client can hydrate its local
   *   message map without waiting for `agent_runtime_end`.
   */
  request_human_approve: async (instruction, state) => {
    const { pendingToolsCalling, skipCreateToolMessage } = instruction as Extract<
      AgentInstruction,
      { type: 'request_human_approve' }
    >;
    const { operationId, stepIndex, streamManager } = ctx;

    log('[%s:%d] Requesting human approval for %O', operationId, stepIndex, pendingToolsCalling);

    // Publish human approval request event
    await streamManager.publishStreamEvent(operationId, {
      data: {
        pendingToolsCalling,
        phase: 'human_approval',
        requiresApproval: true,
      },
      stepIndex,
      type: 'step_start',
    });

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.status = 'waiting_for_human';
    newState.pendingToolsCalling = pendingToolsCalling;

    // Map of toolCallId -> toolMessageId, populated either by creating fresh
    // pending tool messages or (in resumption mode) by looking up existing ones.
    const toolMessageIds: Record<string, string> = {};

    if (skipCreateToolMessage) {
      // Resumption mode: tool messages already exist in DB. Look them up by
      // tool_call_id so we can still ship the mapping to the client.
      log('[%s:%d] Resuming with existing tool messages', operationId, stepIndex);
      try {
        const dbMessages = await ctx.messageModel.query({
          agentId: state.metadata?.agentId,
          threadId: state.metadata?.threadId,
          topicId: state.metadata?.topicId,
        });
        for (const toolPayload of pendingToolsCalling) {
          const existing = dbMessages.find(
            (m: any) => m.role === 'tool' && m.tool_call_id === toolPayload.id,
          );
          if (existing) {
            toolMessageIds[toolPayload.id] = existing.id;
          }
        }
      } catch (error) {
        console.error(
          '[%s:%d] Failed to look up existing tool messages: %O',
          operationId,
          stepIndex,
          error,
        );
      }
    } else {
      // Find parent assistant message. Prefer state.messages (already in
      // memory from call_llm); fall back to DB query if the runtime has been
      // rehydrated without recent messages.
      let parentAssistantId: string | undefined = (state.messages ?? [])
        .slice()
        .reverse()
        .find((m: any) => m.role === 'assistant' && m.id)?.id;

      if (!parentAssistantId) {
        try {
          const dbMessages = await ctx.messageModel.query({
            agentId: state.metadata?.agentId,
            threadId: state.metadata?.threadId,
            topicId: state.metadata?.topicId,
          });
          parentAssistantId = dbMessages
            .slice()
            .reverse()
            .find((m: any) => m.role === 'assistant')?.id;
        } catch (error) {
          console.error(
            '[%s:%d] Failed to query DB for parent assistant: %O',
            operationId,
            stepIndex,
            error,
          );
        }
      }

      if (!parentAssistantId) {
        throw new Error(
          `[request_human_approve] No assistant message found as parent for pending tool messages (op=${operationId})`,
        );
      }

      for (const toolPayload of pendingToolsCalling) {
        const toolName = `${toolPayload.identifier}/${toolPayload.apiName}`;
        try {
          const toolMessage = await ctx.messageModel.create({
            agentId: state.metadata!.agentId!,
            content: '',
            parentId: parentAssistantId,
            plugin: toolPayload as any,
            pluginIntervention: { status: 'pending' },
            role: 'tool',
            threadId: state.metadata?.threadId,
            tool_call_id: toolPayload.id,
            topicId: state.metadata?.topicId,
          });

          toolMessageIds[toolPayload.id] = toolMessage.id;

          // Intentionally DO NOT push the empty placeholder into
          // newState.messages. When the approval resumes, the `call_tool`
          // executor (skip-create branch) appends the resolved tool message
          // to state.messages itself. Pushing a placeholder here produced
          // two entries for the same tool_call_id — see LOBE-7151 review P2.

          log(
            '[%s:%d] Created pending tool message %s for %s',
            operationId,
            stepIndex,
            toolMessage.id,
            toolName,
          );
        } catch (error) {
          console.error(
            '[%s:%d] Failed to create pending tool message for %s: %O',
            operationId,
            stepIndex,
            toolName,
            error,
          );
          throw error;
        }
      }
    }

    // Notify frontend to display approval UI through streaming system.
    // `toolMessageIds` is a new optional field; legacy consumers ignore it.
    await streamManager.publishStreamChunk(operationId, stepIndex, {
      chunkType: 'tools_calling',
      toolMessageIds,
      toolsCalling: pendingToolsCalling as any,
    } as any);

    const events: AgentEvent[] = [
      {
        operationId,
        pendingToolsCalling,
        type: 'human_approve_required',
      },
      {
        // Note: pendingToolsCalling is ChatToolPayload[] but AgentEventToolPending expects ToolsCalling[]
        // This is intentional for display purposes in the frontend
        toolCalls: pendingToolsCalling as any,
        type: 'tool_pending',
      },
    ];

    log('Human approval requested for operation %s:%d', operationId, stepIndex);

    return {
      events,
      newState,
      // Do not provide nextContext as it requires waiting for human intervention
    };
  },

  /**
   * Resolve aborted tool calls
   * Create tool messages with 'aborted' intervention status for canceled tool calls
   */
  resolve_aborted_tools: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'resolve_aborted_tools' }>;
    const { parentMessageId, toolsCalling } = payload;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];

    log('[%s:%d] Resolving %d aborted tools', operationId, stepIndex, toolsCalling.length);

    // Publish tool cancellation event
    await streamManager.publishStreamEvent(operationId, {
      data: {
        parentMessageId,
        phase: 'tools_aborted',
        toolsCalling,
      },
      stepIndex,
      type: 'step_start',
    });

    const newState = structuredClone(state);

    // Create tool message for each canceled tool call
    for (const toolPayload of toolsCalling) {
      const toolName = `${toolPayload.identifier}/${toolPayload.apiName}`;
      log('[%s:%d] Creating aborted tool message for %s', operationId, stepIndex, toolName);

      try {
        const toolMessage = await ctx.messageModel.create({
          agentId: state.metadata!.agentId!,
          content: 'Tool execution was aborted by user.',
          parentId: parentMessageId,
          plugin: toolPayload as any,
          pluginIntervention: { status: 'aborted' },
          role: 'tool',
          threadId: state.metadata?.threadId,
          tool_call_id: toolPayload.id,
          topicId: state.metadata?.topicId,
        });

        log(
          '[%s:%d] Created aborted tool message: %s for %s',
          operationId,
          stepIndex,
          toolMessage.id,
          toolName,
        );

        // Update state messages
        newState.messages.push({
          content: 'Tool execution was aborted by user.',
          role: 'tool',
          tool_call_id: toolPayload.id,
        });
      } catch (error) {
        console.error(
          '[resolve_aborted_tools] Failed to create aborted tool message for %s: %O',
          toolName,
          error,
        );
        // Normalize BEFORE publishing so clients surface the typed business
        // error instead of the raw driver text (see LOBE-7158 review).
        const fatal = isParentMessageMissingError(error)
          ? createConversationParentMissingError(parentMessageId, error)
          : error instanceof Error
            ? error
            : new Error(String(error));
        await streamManager.publishStreamEvent(operationId, {
          data: formatErrorEventData(fatal, 'tool_message_persist'),
          stepIndex,
          type: 'error',
        });
        throw fatal;
      }
    }

    log('[%s:%d] All aborted tool messages created', operationId, stepIndex);

    // Mark status as complete
    newState.lastModified = new Date().toISOString();
    newState.status = 'done';

    // Publish completion event
    await streamManager.publishStreamEvent(operationId, {
      data: {
        finalState: newState,
        phase: 'execution_complete',
        reason: 'user_aborted',
        reasonDetail: 'User aborted operation with pending tool calls',
      },
      stepIndex,
      type: 'step_complete',
    });

    events.push({
      finalState: newState,
      reason: 'user_aborted',
      reasonDetail: 'User aborted operation with pending tool calls',
      type: 'done',
    });

    return { events, newState };
  },
});
