import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import { BUILTIN_AGENT_SLUGS, getAgentRuntimeConfig } from '@lobechat/builtin-agents';
import { builtinSkills } from '@lobechat/builtin-skills';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MessageToolIdentifier } from '@lobechat/builtin-tool-message';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import {
  type DeviceAttachment,
  generateSystemPrompt,
  RemoteDeviceManifest,
} from '@lobechat/builtin-tool-remote-device';
import { builtinTools, manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import { LOADING_FLAT } from '@lobechat/const';
import type {
  AgentManagementContext,
  LobeToolManifest,
  ToolExecutor,
  ToolSource,
} from '@lobechat/context-engine';
import { SkillEngine } from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import type {
  ChatFileItem,
  ChatTopicBotContext,
  ChatVideoItem,
  ExecAgentParams,
  ExecAgentResult,
  ExecGroupAgentParams,
  ExecGroupAgentResult,
  ExecSubAgentTaskParams,
  ExecSubAgentTaskResult,
  MessagePluginItem,
  UserInterventionConfig,
} from '@lobechat/types';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { AiModelModel } from '@/database/models/aiModel';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { shouldEnableBuiltinSkill } from '@/helpers/skillFilters';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import {
  createServerAgentToolsEngine,
  type EvalContext,
  type ServerAgentToolsContext,
} from '@/server/modules/Mecha';
import { type ServerUserMemoryConfig } from '@/server/modules/Mecha/ContextEngineering/types';
import { AgentService } from '@/server/services/agent';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import type { AgentRuntimeServiceOptions } from '@/server/services/agentRuntime';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { getAbortError, isAbortError, throwIfAborted } from '@/server/services/agentRuntime/abort';
import { hookDispatcher } from '@/server/services/agentRuntime/hooks';
import { type AgentHook } from '@/server/services/agentRuntime/hooks/types';
import { type StepLifecycleCallbacks } from '@/server/services/agentRuntime/types';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { KlavisService } from '@/server/services/klavis';
import { MarketService } from '@/server/services/market';
import { deviceProxy } from '@/server/services/toolExecution/deviceProxy';

import { ingestAttachment } from './ingestAttachment';

const log = debug('lobe-server:ai-agent-service');

/**
 * Format error for storage in thread metadata
 * Handles Error objects which don't serialize properly with JSON.stringify
 */
function formatErrorForMetadata(error: unknown): Record<string, any> | undefined {
  if (!error) return undefined;

  // Handle Error objects
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  // Handle objects with message property (like ChatMessageError)
  if (typeof error === 'object' && 'message' in error) {
    return error as Record<string, any>;
  }

  // Fallback: wrap in object
  return { message: String(error) };
}

/**
 * Internal params for execAgent with step lifecycle callbacks
 * This extends the public ExecAgentParams with server-side only options
 */
interface InternalExecAgentParams extends ExecAgentParams {
  /** Additional plugin IDs to inject (e.g., task tool during task execution) */
  additionalPluginIds?: string[];
  /** Bot context for topic metadata (platform, applicationId, platformThreadId) */
  botContext?: ChatTopicBotContext;
  /** Bot platform context for injecting platform capabilities (e.g. markdown support) */
  botPlatformContext?: any;
  /** Cron job ID that triggered this execution (if trigger is 'cron') */
  cronJobId?: string;
  /** Disable all tools (no plugins, no system manifests). Useful for eval/benchmark scenarios. */
  disableTools?: boolean;
  /** Discord context for injecting channel/guild info into agent system message */
  discordContext?: any;
  /** Eval context for injecting environment prompts into system message */
  evalContext?: EvalContext;
  /** External files to upload to S3 and attach to the user message */
  files?: Array<{
    /** Pre-downloaded buffer (from adapter/platform layer) */
    buffer?: Buffer;
    mimeType?: string;
    name?: string;
    size?: number;
    /** External URL — fetched if no buffer provided */
    url?: string;
  }>;
  /** Client-side function tools from Response API — injected into LLM with source='client' */
  functionTools?: Array<{ description?: string; name: string; parameters?: Record<string, any> }>;
  /** External lifecycle hooks (auto-adapt to local/production mode) */
  hooks?: AgentHook[];
  /** Initial step count offset for resumed operations (accumulated from previous runs) */
  initialStepCount?: number;
  /** Maximum steps for the agent operation */
  maxSteps?: number;
  /** Parent message ID to continue from. Only takes effect when resume is true */
  parentMessageId?: string;
  queueRetries?: number;
  queueRetryDelay?: string;
  /** Whether to continue execution from an existing persisted message */
  resume?: boolean;
  /**
   * When present, this execAgent call acts as the "continue" step for a
   * previous op that hit `human_approve_required`. The service writes the
   * decision to the target tool message and either runs the approved tool
   * (`approved`), halts with `reason='human_rejected'` (`rejected`), or
   * surfaces the rejection as user feedback so the LLM can respond
   * (`rejected_continue`). `parentMessageId` must point at the pending tool
   * message.
   */
  resumeApproval?: {
    decision: 'approved' | 'rejected' | 'rejected_continue';
    parentMessageId: string;
    rejectionReason?: string;
    toolCallId: string;
  };
  /** Abort startup before the agent runtime operation is created */
  signal?: AbortSignal;
  /**
   * Whether the LLM call should use streaming.
   * Defaults to true. Set to false for non-streaming scenarios (e.g., bot integrations).
   */
  stream?: boolean;
  /** Task ID that triggered this execution (if trigger is 'task') */
  taskId?: string;
  /**
   * Custom title for the topic.
   * When provided (including empty string), overrides the default prompt-based title.
   * When undefined, falls back to prompt.slice(0, 50).
   */
  title?: string;
  /** Topic creation trigger source ('cron' | 'chat' | 'api' | 'task') */
  trigger?: string;
  /**
   * User intervention configuration
   * Use { approvalMode: 'headless' } for async tasks that should never wait for human approval
   */
  userInterventionConfig?: UserInterventionConfig;
}

/**
 * AI Agent Service
 *
 * Encapsulates agent execution logic that can be triggered via:
 * - tRPC router (aiAgent.execAgent)
 * - REST API endpoint (/api/agent)
 * - Cron jobs / scheduled tasks
 */
export class AiAgentService {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly agentDocumentsService: AgentDocumentsService;
  private readonly agentModel: AgentModel;
  private readonly agentService: AgentService;
  private readonly messageModel: MessageModel;
  private readonly pluginModel: PluginModel;
  private readonly threadModel: ThreadModel;
  private readonly topicModel: TopicModel;
  private readonly agentRuntimeService: AgentRuntimeService;
  private readonly marketService: MarketService;
  private readonly klavisService: KlavisService;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    options?: { runtimeOptions?: AgentRuntimeServiceOptions },
  ) {
    this.userId = userId;
    this.db = db;
    this.agentDocumentsService = new AgentDocumentsService(db, userId);
    this.agentModel = new AgentModel(db, userId);
    this.agentService = new AgentService(db, userId);
    this.messageModel = new MessageModel(db, userId);
    this.pluginModel = new PluginModel(db, userId);
    this.threadModel = new ThreadModel(db, userId);
    this.topicModel = new TopicModel(db, userId);
    this.agentRuntimeService = new AgentRuntimeService(db, userId, options?.runtimeOptions);
    this.marketService = new MarketService({ userInfo: { userId } });
    this.klavisService = new KlavisService({ db, userId });
  }

  /**
   * Execute agent with just a prompt
   *
   * This is a simplified API that requires agent identifier (id or slug) and prompt.
   * All necessary data (agent config, tools, messages) will be fetched from the database.
   *
   * Architecture:
   * execAgent({ agentId | slug, prompt })
   *   → AgentModel.getAgentConfig(idOrSlug)
   *   → ServerMechaModule.AgentToolsEngine(config)
   *   → ServerMechaModule.ContextEngineering(input, config, messages)
   *   → AgentRuntimeService.createOperation(...)
   */
  async execAgent(params: InternalExecAgentParams): Promise<ExecAgentResult> {
    const {
      additionalPluginIds,
      agentId,
      slug,
      prompt,
      appContext,
      autoStart = true,
      botContext,
      clientRuntime,
      deviceId: requestedDeviceId,
      botPlatformContext,
      discordContext,
      existingMessageIds = [],
      fileIds: attachedFileIds,
      files,
      functionTools,
      hooks,
      instructions,
      model: modelOverride,
      provider: providerOverride,
      stream,
      title,
      trigger,
      cronJobId,
      taskId,
      evalContext,
      maxSteps,
      initialStepCount,
      signal,
      userInterventionConfig = { approvalMode: 'headless' },
      queueRetries,
      queueRetryDelay,
      parentMessageId,
      resume,
      resumeApproval,
    } = params;

    // Validate that either agentId or slug is provided
    if (!agentId && !slug) {
      throw new Error('Either agentId or slug must be provided');
    }

    // Determine the identifier to use (agentId takes precedence)
    const identifier = agentId || slug!;

    log('execAgent: identifier=%s, prompt=%s', identifier, prompt.slice(0, 50));

    const assistantMessageRef: { current?: string } = {};
    const updateAbortedAssistantMessage = async (errorMessage: string) => {
      if (!assistantMessageRef.current) return;

      try {
        await this.messageModel.update(assistantMessageRef.current, {
          content: '',
          error: {
            body: {
              detail: errorMessage,
            },
            message: errorMessage,
            type: 'ServerAgentRuntimeError',
          },
        });
      } catch (error) {
        log(
          'execAgent: failed to update aborted assistant message %s: %O',
          assistantMessageRef.current,
          error,
        );
      }
    };
    const throwIfExecutionAborted = async (stage: string) => {
      if (!signal?.aborted) return;

      const error = getAbortError(signal, `Agent execution aborted during ${stage}`);
      await updateAbortedAssistantMessage(error.message);
      throw error;
    };

    throwIfAborted(signal, 'Agent execution aborted before startup');

    // 1. Get agent configuration with default config merged (supports both id and slug)
    const agentConfig = await this.agentService.getAgentConfig(identifier);
    if (!agentConfig) {
      throw new Error(`Agent not found: ${identifier}`);
    }

    // Use actual agent ID from config for subsequent operations
    const resolvedAgentId = agentConfig.id;

    // Apply per-call model/provider overrides (e.g. from task.config)
    if (modelOverride) agentConfig.model = modelOverride;
    if (providerOverride) agentConfig.provider = providerOverride;

    log(
      'execAgent: got agent config for %s (id: %s), model: %s, provider: %s',
      identifier,
      resolvedAgentId,
      agentConfig.model,
      agentConfig.provider,
    );

    // 2. Merge builtin agent runtime config (systemRole, plugins)
    // The DB only stores persist config. Runtime config (e.g. inbox systemRole) is generated dynamically.
    const agentSlug = agentConfig.slug;
    const builtinSlugs = Object.values(BUILTIN_AGENT_SLUGS) as string[];
    if (agentSlug && builtinSlugs.includes(agentSlug)) {
      const runtimeConfig = getAgentRuntimeConfig(agentSlug, {
        model: agentConfig.model,
        plugins: agentConfig.plugins ?? [],
      });
      if (runtimeConfig) {
        // Runtime systemRole takes effect only if DB has no user-customized systemRole
        if (!agentConfig.systemRole && runtimeConfig.systemRole) {
          agentConfig.systemRole = runtimeConfig.systemRole;
          log('execAgent: merged builtin agent runtime systemRole for slug=%s', agentSlug);
        }
        // Runtime plugins merged (runtime plugins take priority if provided)
        if (runtimeConfig.plugins && runtimeConfig.plugins.length > 0) {
          agentConfig.plugins = runtimeConfig.plugins;
          log('execAgent: merged builtin agent runtime plugins for slug=%s', agentSlug);
        }
      }
    }

    if (appContext?.scope !== 'page') {
      agentConfig.plugins = agentConfig.plugins?.filter((id) => id !== PageAgentIdentifier);
    }

    if (appContext?.scope === 'page' && agentSlug !== BUILTIN_AGENT_SLUGS.pageAgent) {
      const pageAgentRuntime = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.pageAgent, {
        model: agentConfig.model,
        plugins: agentConfig.plugins ?? [],
      });
      const pageAgentSystemRole = pageAgentRuntime?.systemRole || '';

      if (pageAgentSystemRole) {
        agentConfig.systemRole = agentConfig.systemRole
          ? `${agentConfig.systemRole}\n\n${pageAgentSystemRole}`
          : pageAgentSystemRole;
      }

      agentConfig.plugins = agentConfig.plugins?.includes(PageAgentIdentifier)
        ? agentConfig.plugins
        : [PageAgentIdentifier, ...(agentConfig.plugins ?? [])];
      agentConfig.chatConfig = {
        ...agentConfig.chatConfig,
        enableHistoryCount: false,
      };
      log('execAgent: injected page-agent runtime for page scope');
    }

    await throwIfExecutionAborted('agent configuration');

    // 2.5. Append additional instructions to agent's systemRole
    if (instructions) {
      agentConfig.systemRole = agentConfig.systemRole
        ? `${agentConfig.systemRole}\n\n${instructions}`
        : instructions;
      log('execAgent: appended additional instructions to systemRole');
    }

    let resumeParentMessage;

    // `resumeApproval` implies the same "load parent message + skip user
    // message creation" semantics as `resume`. Callers that go through the
    // tRPC router get `resume: true` via the router, but the service-level
    // API allows resumeApproval alone — fold both into a single effective
    // flag so downstream resume branches don't need to know about approval.
    const effectiveResume = resume || !!resumeApproval;

    if (effectiveResume) {
      if (!parentMessageId) {
        throw new Error('parentMessageId is required when resume is true');
      }

      if (!appContext) {
        throw new Error('appContext is required when resume is true');
      }

      if (!appContext.topicId) {
        throw new Error('appContext.topicId is required when resume is true');
      }

      resumeParentMessage = await this.messageModel.findById(parentMessageId);

      if (!resumeParentMessage) {
        throw new Error(`Parent message not found: ${parentMessageId}`);
      }

      if (resumeParentMessage.topicId !== appContext.topicId) {
        throw new Error('appContext.topicId does not match parent message');
      }

      if (
        resumeParentMessage.threadId &&
        resumeParentMessage.threadId !== (appContext.threadId ?? undefined)
      ) {
        throw new Error('appContext.threadId does not match parent message');
      }

      if (resumeParentMessage.sessionId && resumeParentMessage.sessionId !== appContext.sessionId) {
        throw new Error('appContext.sessionId does not match parent message');
      }
    }

    // 2.6. Human-approval resume: write the user's decision to the target tool
    // message in the DB so the history fetched below (step 11) + the runtime
    // state both reflect the decision before the first step runs. Validates
    // the parent is actually a pending tool message tied to the tool call we
    // were asked about — guards against stale / double-clicks.
    //
    // Note: `messages` and `message_plugins` live in separate tables. The
    // `messageModel.findById` query returns the `messages` row only — the
    // tool_call_id / apiName / identifier / arguments / type fields live on
    // the plugin row and must be fetched separately.
    let resumeApprovalPlugin: MessagePluginItem | undefined;

    if (resumeApproval) {
      if (!resumeParentMessage) {
        throw new Error('resumeApproval requires parentMessageId to point at a tool message');
      }
      if (resumeParentMessage.role !== 'tool') {
        throw new Error(
          `resumeApproval.parentMessageId must point at a role='tool' message, got role='${resumeParentMessage.role}'`,
        );
      }

      resumeApprovalPlugin = await this.messageModel.findMessagePlugin(
        resumeApproval.parentMessageId,
      );
      if (!resumeApprovalPlugin) {
        throw new Error(
          `resumeApproval: no plugin row for tool message ${resumeApproval.parentMessageId}`,
        );
      }
      if (
        resumeApprovalPlugin.toolCallId &&
        resumeApprovalPlugin.toolCallId !== resumeApproval.toolCallId
      ) {
        throw new Error(
          `resumeApproval.toolCallId mismatch for message ${resumeApproval.parentMessageId}: ` +
            `stored=${resumeApprovalPlugin.toolCallId}, requested=${resumeApproval.toolCallId}`,
        );
      }

      const { decision, rejectionReason } = resumeApproval;
      if (decision === 'approved') {
        await this.messageModel.updateMessagePlugin(resumeApproval.parentMessageId, {
          intervention: { status: 'approved' },
        });
      } else {
        // rejected / rejected_continue both write the same rejection content
        // + intervention state. The difference surfaces later in how the new
        // op's initial state/context are configured (halt vs. continue LLM).
        const rejectionContent = rejectionReason
          ? `User reject this tool calling with reason: ${rejectionReason}`
          : 'User reject this tool calling without reason';
        await this.messageModel.updateToolMessage(resumeApproval.parentMessageId, {
          content: rejectionContent,
        });
        await this.messageModel.updateMessagePlugin(resumeApproval.parentMessageId, {
          intervention: { rejectedReason: rejectionReason, status: 'rejected' },
        });
      }

      log(
        'execAgent: resumeApproval decision=%s applied to tool message %s (toolCallId=%s)',
        decision,
        resumeApproval.parentMessageId,
        resumeApproval.toolCallId,
      );
    }

    // 3. Handle topic creation: if no topicId provided, create a new topic; otherwise reuse existing
    let topicId = appContext?.topicId;
    const topicBoundDeviceId = requestedDeviceId;
    if (!topicId) {
      if (resume) {
        throw new Error('Resume mode requires the parent message to belong to a topic');
      }

      // Prepare metadata with cronJobId, taskId, botContext, and bound device if provided
      const metadata =
        cronJobId || taskId || botContext || requestedDeviceId
          ? {
              bot: botContext,
              boundDeviceId: requestedDeviceId,
              cronJobId: cronJobId || undefined,
              taskId: taskId || undefined,
            }
          : undefined;

      const newTopic = await this.topicModel.create({
        agentId: resolvedAgentId,
        metadata,
        title:
          title !== undefined ? title : prompt.slice(0, 50) + (prompt.length > 50 ? '...' : ''),
        trigger,
      });
      topicId = newTopic.id;
      log(
        'execAgent: created new topic %s with trigger %s, cronJobId %s',
        topicId,
        trigger || 'default',
        cronJobId || 'none',
      );
    } else {
      log('execAgent: reusing existing topic %s', topicId);
    }

    await throwIfExecutionAborted('topic setup');

    // Extract model and provider from agent config
    const model = agentConfig.model!;
    const provider = agentConfig.provider!;

    // 4. Fetch user settings (memory config + timezone)
    // Agent-level memory config takes priority; fallback to user-level setting
    const agentMemoryEnabled = agentConfig.chatConfig?.memory?.enabled;
    let globalMemoryEnabled = agentMemoryEnabled ?? false;
    let userTimezone: string | undefined;
    try {
      const userModel = new UserModel(this.db, this.userId);
      const settings = await userModel.getUserSettings();
      const memorySettings = settings?.memory as { enabled?: boolean } | undefined;

      globalMemoryEnabled = agentMemoryEnabled ?? memorySettings?.enabled !== false;

      const generalSettings = settings?.general as { timezone?: string } | undefined;
      userTimezone = generalSettings?.timezone;
    } catch (error) {
      log('execAgent: failed to fetch user settings: %O', error);
    }
    log(
      'execAgent: globalMemoryEnabled=%s, timezone=%s',
      globalMemoryEnabled,
      userTimezone ?? 'default',
    );

    // 5. Tool discovery — short-circuit when disableTools is set
    let tools: any[] | undefined;
    let toolsResult: { enabledToolIds: string[]; tools?: any[] | undefined } = {
      enabledToolIds: [],
      tools: undefined,
    };
    const toolManifestMap: Record<string, any> = {};
    const toolSourceMap: Record<string, ToolSource> = {};
    const toolExecutorMap: Record<string, ToolExecutor> = {};
    let onlineDevices: DeviceAttachment[] = [];
    let activeDeviceId: string | undefined;
    let hasAgentDocuments = false;
    let hasEnabledKnowledgeBases = false;
    const isBotConversation = !!(botContext || discordContext);

    // These are needed outside the tools block (for agent management context, skill engine, etc.)
    let lobehubSkillManifests: LobeToolManifest[] = [];
    let klavisManifests: LobeToolManifest[] = [];
    let agentPlugins: string[] = [...(agentConfig?.plugins ?? []), ...(additionalPluginIds || [])];

    // model-bank is needed both for tool support check and model metadata
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    if (params.disableTools) {
      log('execAgent: tools disabled by disableTools flag, skipping all tool discovery');
    } else {
      // 5a. Get installed plugins from database
      const installedPlugins = await this.pluginModel.query();
      log('execAgent: got %d installed plugins', installedPlugins.length);

      // 5b. Get model abilities from model-bank for function calling support check
      const isModelSupportToolUse = (m: string, p: string) => {
        const info = LOBE_DEFAULT_MODEL_LIST.find((item) => item.id === m && item.providerId === p);
        return info?.abilities?.functionCall ?? true;
      };

      // 5c. Fetch LobeHub Skills manifests
      try {
        lobehubSkillManifests = await this.marketService.getLobehubSkillManifests();
      } catch (error) {
        log('execAgent: failed to fetch lobehub skill manifests: %O', error);
      }
      log('execAgent: got %d lobehub skill manifests', lobehubSkillManifests.length);

      // 5d. Fetch Klavis tool manifests from database
      try {
        klavisManifests = await this.klavisService.getKlavisManifests();
      } catch (error) {
        log('execAgent: failed to fetch klavis manifests: %O', error);
      }
      log('execAgent: got %d klavis manifests', klavisManifests.length);

      await throwIfExecutionAborted('tool discovery');

      // 5e. Create tools using Server AgentToolsEngine
      hasEnabledKnowledgeBases =
        agentConfig.knowledgeBases?.some(
          (kb: { enabled?: boolean | null }) => kb.enabled === true,
        ) ?? false;

      try {
        const docs = await this.agentDocumentsService.getAgentDocuments(resolvedAgentId);
        hasAgentDocuments = docs.length > 0;
      } catch {
        // Agent documents check is non-critical
      }

      log('execAgent: isBotConversation=%s', isBotConversation);

      // Build device context for ToolsEngine enableChecker
      const gatewayConfigured = deviceProxy.isConfigured;
      const agentBoundDeviceId = agentConfig.agencyConfig?.boundDeviceId;
      const boundDeviceId = topicBoundDeviceId || agentBoundDeviceId;
      if (gatewayConfigured) {
        try {
          onlineDevices = await deviceProxy.queryDeviceList(this.userId);
          log('execAgent: found %d online device(s)', onlineDevices.length);
        } catch (error) {
          log('execAgent: failed to query device list: %O', error);
        }
      }
      const deviceOnline = onlineDevices.length > 0;

      const toolsContext: ServerAgentToolsContext = {
        installedPlugins,
        isModelSupportToolUse,
      };

      // Dynamically inject topic-reference tool when prompt contains <refer_topic> tags
      const hasTopicReference = /refer_topic/.test(prompt ?? '');
      agentPlugins = [
        ...agentPlugins,
        ...(hasTopicReference ? ['lobe-topic-reference'] : []),
        ...(isBotConversation ? [MessageToolIdentifier] : []),
      ];

      // Derive activeDeviceId from device context:
      // 1. If this run explicitly requested a device and that device is online, use it
      // 2. Otherwise, if the current topic has a bound device and it is online, use that
      // 3. Otherwise, fall back to the agent-level bound device when it is online
      // 4. Otherwise, in IM/Bot scenarios, auto-activate only when exactly one device is online
      activeDeviceId = boundDeviceId
        ? onlineDevices.some((device) => device.deviceId === boundDeviceId)
          ? boundDeviceId
          : undefined
        : (discordContext || botContext) && onlineDevices.length === 1
          ? onlineDevices[0].deviceId
          : undefined;

      const toolsEngine = createServerAgentToolsEngine(toolsContext, {
        additionalManifests: [...lobehubSkillManifests, ...klavisManifests],
        agentConfig: {
          chatConfig: agentConfig.chatConfig ?? undefined,
          plugins: agentPlugins,
        },
        clientRuntime,
        deviceContext: gatewayConfigured
          ? {
              autoActivated: activeDeviceId ? true : undefined,
              boundDeviceId,
              deviceOnline,
              gatewayConfigured: true,
            }
          : undefined,
        globalMemoryEnabled,
        hasAgentDocuments,
        hasEnabledKnowledgeBases,
        isBotConversation,
        model,
        provider,
      });

      // 5f. Generate tools and manifest map
      const pluginIds = [
        ...(agentConfig.plugins || []),
        ...(additionalPluginIds || []),
        LocalSystemManifest.identifier,
        RemoteDeviceManifest.identifier,
        ...(isBotConversation ? [MessageToolIdentifier] : []),
        // Include LobeHub Skills and Klavis tools so they are passed to generateToolsDetailed
        ...lobehubSkillManifests.map((m) => m.identifier),
        ...klavisManifests.map((m) => m.identifier),
      ];
      log('execAgent: agent configured plugins: %O', pluginIds);

      const isManualMode = agentConfig.chatConfig?.skillActivateMode === 'manual';

      toolsResult = toolsEngine.generateToolsDetailed({
        excludeDefaultToolIds: isManualMode ? manualModeExcludeToolIds : undefined,
        model,
        provider,
        toolIds: pluginIds,
      });

      tools = toolsResult.tools;

      log('execAgent: enabled tool ids: %O', toolsResult.enabledToolIds);

      // Start with the scoped manifest map (pluginIds + defaultToolIds)
      const manifestMap = toolsEngine.getEnabledPluginManifests(pluginIds);
      manifestMap.forEach((manifest, id) => {
        toolManifestMap[id] = manifest;
      });

      // Also include discoverable builtin tools that are not yet in the map,
      // so the activator can find their manifests when dynamically enabling them
      // (e.g., lobe-creds, lobe-cron). Exclude discoverable:false tools to prevent
      // internal infrastructure tools from being surfaced to the activator.
      for (const tool of builtinTools) {
        if (tool.discoverable !== false && !toolManifestMap[tool.identifier]) {
          toolManifestMap[tool.identifier] = tool.manifest as LobeToolManifest;
        }
      }

      // Include lobehub skill and klavis manifests for activator discovery
      for (const manifest of lobehubSkillManifests) {
        if (!toolManifestMap[manifest.identifier]) {
          toolManifestMap[manifest.identifier] = manifest;
        }
      }
      for (const manifest of klavisManifests) {
        if (!toolManifestMap[manifest.identifier]) {
          toolManifestMap[manifest.identifier] = manifest;
        }
      }

      for (const manifest of lobehubSkillManifests) {
        toolSourceMap[manifest.identifier] = 'lobehubSkill';
      }
      for (const manifest of klavisManifests) {
        toolSourceMap[manifest.identifier] = 'klavis';
      }

      // Mark tools that must run on the client (desktop Electron) because they
      // require local IPC / subprocess capabilities:
      //   - local-system builtin: Electron IPC for file + command execution
      //   - stdio MCP plugins: subprocess lives on the user's machine
      //
      // Two triggers, in priority order:
      //  (a) `clientRuntime === 'desktop'` — the caller itself is an Electron
      //      client on the Agent Gateway WS and is ready to receive
      //      `tool_execute`. This is the Phase 6.4 path and is authoritative
      //      regardless of whether DEVICE_GATEWAY (the legacy device-proxy) is
      //      also configured.
      //  (b) `!gatewayConfigured` — no DEVICE_GATEWAY configured on the server,
      //      so legacy Remote Device proxy isn't an option and any client
      //      tooling falls through to the Gateway WS (standalone Electron).
      //
      // When DEVICE_GATEWAY is configured AND the caller is a web client, we
      // leave executor unset so tools route via RemoteDevice proxy.
      const shouldDispatchToClient = clientRuntime === 'desktop' || !gatewayConfigured;
      if (shouldDispatchToClient) {
        // Tools that declare `executors` including `'client'` in their
        // manifest are dispatched to the client when a desktop caller is
        // connected. `toolManifestMap` is a superset of `manifestMap`
        // (includes both enabled plugins and discoverable builtins).
        for (const id of Object.keys(toolManifestMap)) {
          if (toolManifestMap[id]?.executors?.includes('client')) {
            toolExecutorMap[id] = 'client';
          }
        }
        // Stdio MCP plugins: subprocess lives on the user's machine
        for (const plugin of installedPlugins) {
          if (plugin.customParams?.mcp?.type === 'stdio' && manifestMap.has(plugin.identifier)) {
            toolExecutorMap[plugin.identifier] = 'client';
          }
        }
      }

      log(
        'execAgent: generated %d tools, %d lobehub skills, %d klavis tools',
        tools?.length ?? 0,
        lobehubSkillManifests.length,
        klavisManifests.length,
      );
    }

    // Inject client function tools from Response API
    const CLIENT_FN_IDENTIFIER = 'lobe-client-fn';
    if (functionTools?.length) {
      for (const ft of functionTools) {
        tools?.push({
          function: {
            description: ft.description,
            name: `${CLIENT_FN_IDENTIFIER}____${ft.name}`,
            parameters: ft.parameters,
          },
          type: 'function',
        });
      }
      toolSourceMap[CLIENT_FN_IDENTIFIER] = 'client';
      toolManifestMap[CLIENT_FN_IDENTIFIER] = {
        api: functionTools.map((ft) => ({
          description: ft.description ?? '',
          name: ft.name,
          parameters: ft.parameters ?? {},
        })),
        identifier: CLIENT_FN_IDENTIFIER,
        meta: { title: 'Client Functions' },
        type: 'default',
      };
      toolsResult.enabledToolIds.push(CLIENT_FN_IDENTIFIER);
    }

    // Override RemoteDevice manifest's systemRole with dynamic device list prompt
    // The manifest is already included/excluded by ToolsEngine enableChecker
    if (toolManifestMap[RemoteDeviceManifest.identifier]) {
      toolManifestMap[RemoteDeviceManifest.identifier] = {
        ...toolManifestMap[RemoteDeviceManifest.identifier],
        systemRole: generateSystemPrompt(onlineDevices),
      };
    }

    // 9.4. Fetch device system info for placeholder variable replacement
    let deviceSystemInfo: Record<string, string> = {};
    if (activeDeviceId) {
      try {
        const systemInfo = await deviceProxy.queryDeviceSystemInfo(this.userId, activeDeviceId);
        if (systemInfo) {
          const activeDevice = onlineDevices.find((d) => d.deviceId === activeDeviceId);
          deviceSystemInfo = {
            arch: systemInfo.arch,
            desktopPath: systemInfo.desktopPath,
            documentsPath: systemInfo.documentsPath,
            downloadsPath: systemInfo.downloadsPath,
            homePath: systemInfo.homePath,
            hostname: activeDevice?.hostname ?? 'unknown',
            musicPath: systemInfo.musicPath,
            picturesPath: systemInfo.picturesPath,
            platform: activeDevice?.platform ?? 'unknown',
            userDataPath: systemInfo.userDataPath,
            videosPath: systemInfo.videosPath,
            workingDirectory: systemInfo.workingDirectory,
          };
          log('execAgent: fetched device system info for %s', activeDeviceId);
        }
      } catch (error) {
        log('execAgent: failed to fetch device system info: %O', error);
      }
    }

    // 9.5. Build Agent Management context
    // - availableAgents is injected whenever the user is in auto mode (so the supervisor
    //   can decide to activate agent-management on its own) OR when the tool is explicitly enabled.
    // - availableProviders / availablePlugins are only built when the tool is explicitly
    //   enabled, since they're solely needed for createAgent / updateAgent.
    const isAgentManagementEnabled = toolsResult.enabledToolIds?.includes('lobe-agent-management');
    const isInAutoSkillMode = agentConfig.chatConfig?.skillActivateMode !== 'manual';
    const shouldInjectAvailableAgents = isInAutoSkillMode || isAgentManagementEnabled;
    let agentManagementContext: AgentManagementContext | undefined;

    if (shouldInjectAvailableAgents) {
      // Query user's most recently updated agents.
      // Over-fetch by 2: +1 reserved for the current agent (filtered out below
      // so the model has no exposure to its own id and cannot self-delegate)
      // and +1 to detect overflow for the `hasMore` flag.
      const AVAILABLE_AGENTS_LIMIT = 10;
      const recentAgents = await this.agentModel.queryAgents({
        limit: AVAILABLE_AGENTS_LIMIT + 2,
      });

      // Exclude the current agent from `availableAgents` — the model is the current
      // agent. Its persona/identity is already established by `systemRole`, so we
      // don't re-inject it here, and removing self from the list ensures the model
      // never sees its own id in the agent-management context (so it can't
      // accidentally call itself via `callAgent`).
      const otherAgents = recentAgents.filter((a) => a.id !== resolvedAgentId);
      const hasMoreAgents = otherAgents.length > AVAILABLE_AGENTS_LIMIT;
      const availableAgents = otherAgents.slice(0, AVAILABLE_AGENTS_LIMIT).map((a) => ({
        description: a.description ?? undefined,
        id: a.id,
        title: a.title ?? 'Untitled',
      }));

      agentManagementContext = {
        availableAgents,
        availableAgentsHasMore: hasMoreAgents,
        ...(resolvedAgentId && {
          currentAgent: {
            id: resolvedAgentId,
            title: agentConfig.title ?? undefined,
          },
        }),
      };
    }

    if (isAgentManagementEnabled) {
      // Query user's enabled models from database
      const aiModelModel = new AiModelModel(this.db, this.userId);
      const allUserModels = await aiModelModel.getAllModels();

      // Filter only enabled chat models and group by provider
      const providerMap = new Map<
        string,
        {
          id: string;
          models: Array<{ abilities?: any; description?: string; id: string; name: string }>;
          name: string;
        }
      >();

      for (const userModel of allUserModels) {
        // Only include enabled chat models
        if (!userModel.enabled || userModel.type !== 'chat') continue;

        // Get model info from LOBE_DEFAULT_MODEL_LIST for full metadata
        const modelInfo = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => m.id === userModel.id && m.providerId === userModel.providerId,
        );

        if (!providerMap.has(userModel.providerId)) {
          providerMap.set(userModel.providerId, {
            id: userModel.providerId,
            models: [],
            name: userModel.providerId, // TODO: Map to friendly provider name
          });
        }

        const provider = providerMap.get(userModel.providerId)!;
        provider.models.push({
          abilities: userModel.abilities || modelInfo?.abilities,
          description: modelInfo?.description,
          id: userModel.id,
          name: userModel.displayName || modelInfo?.displayName || userModel.id,
        });
      }

      // Build availablePlugins from all plugin sources
      // Exclude only truly internal tools (agent-management itself, agent-builder, page-agent)
      const INTERNAL_TOOLS = new Set([
        'lobe-agent-management', // Don't show agent-management in its own context
        'lobe-agent-builder', // Used for editing current agent, not for creating new agents
        'lobe-group-agent-builder', // Used for editing current group, not for creating new agents
        'lobe-page-agent', // Page-editor specific tool
      ]);

      const availablePlugins = [
        // All builtin tools (including hidden ones like web-browsing, cloud-sandbox)
        ...builtinTools
          .filter((tool) => !INTERNAL_TOOLS.has(tool.identifier))
          .map((tool) => ({
            description: tool.manifest.meta?.description,
            identifier: tool.identifier,
            name: tool.manifest.meta?.title || tool.identifier,
            type: 'builtin' as const,
          })),
        // Lobehub Skills
        ...lobehubSkillManifests.map((manifest) => ({
          description: manifest.meta?.description,
          identifier: manifest.identifier,
          name: manifest.meta?.title || manifest.identifier,
          type: 'lobehub-skill' as const,
        })),
        // Klavis tools
        ...klavisManifests.map((manifest) => ({
          description: manifest.meta?.description,
          identifier: manifest.identifier,
          name: manifest.meta?.title || manifest.identifier,
          type: 'klavis' as const,
        })),
      ];

      // Merge models / plugins into the (already-initialized) agentManagementContext.
      // availableAgents was populated above by `shouldInjectAvailableAgents`, which is
      // always true when isAgentManagementEnabled.
      agentManagementContext = {
        ...agentManagementContext!,
        availablePlugins,
        // Limit to first 5 providers to avoid context bloat
        availableProviders: Array.from(providerMap.values()).slice(0, 5),
      };

      log(
        'execAgent: built agentManagementContext with %d providers, %d plugins, %d agents',
        agentManagementContext.availableProviders!.length,
        agentManagementContext.availablePlugins!.length,
        agentManagementContext.availableAgents?.length ?? 0,
      );
    } else if (agentManagementContext) {
      log(
        'execAgent: injected availableAgents only (auto mode, agent-management tool not enabled): %d agents',
        agentManagementContext.availableAgents?.length ?? 0,
      );
    }

    await throwIfExecutionAborted('tool preparation');

    // 10. Fetch user persona for memory injection (reuses globalMemoryEnabled from step 8)
    let userMemory: ServerUserMemoryConfig | undefined;

    if (globalMemoryEnabled) {
      try {
        const personaModel = new UserPersonaModel(this.db, this.userId);
        const persona = await personaModel.getLatestPersonaDocument();

        if (persona?.persona) {
          userMemory = {
            fetchedAt: Date.now(),
            memories: {
              contexts: [],
              experiences: [],
              persona: {
                narrative: persona.persona,
                tagline: persona.tagline,
              },
              preferences: [],
            },
          };
          log('execAgent: fetched user persona (version: %d)', persona.version);
        }
      } catch (error) {
        log('execAgent: failed to fetch user persona: %O', error);
      }
    }

    // 11. Get existing messages if provided
    // Use postProcessUrl to resolve S3 keys in imageList to publicly accessible URLs,
    // matching the frontend flow in aiChatService.getMessagesAndTopics.
    const fileService = new FileService(this.db, this.userId);
    const postProcessUrl = (path: string | null) => fileService.getFullFileUrl(path);

    let historyMessages: any[] = [];
    if (existingMessageIds.length > 0) {
      historyMessages = await this.messageModel.query(
        {
          sessionId: appContext?.sessionId,
          threadId: appContext?.threadId,
          topicId: appContext?.topicId ?? undefined,
        },
        { postProcessUrl },
      );
      const idSet = new Set(existingMessageIds);
      historyMessages = historyMessages.filter((msg) => idSet.has(msg.id));
    } else if (appContext?.topicId) {
      // Follow-up message in existing topic: load all history for context
      historyMessages = await this.messageModel.query(
        {
          sessionId: appContext?.sessionId,
          threadId: appContext?.threadId,
          topicId: appContext?.topicId,
        },
        { postProcessUrl },
      );
    }

    await throwIfExecutionAborted('message history loading');

    // 12. Collect Phase 2 warnings (ingestion/parsing errors) alongside Phase 1 warnings
    // Phase 1 warnings (e.g. file too large) are already in botPlatformContext.warnings
    const warnings: string[] = [];

    // 13. Upload external files to S3 and collect file IDs
    let fileIds: string[] | undefined;
    let imageList: Array<{ alt: string; id: string; url: string }> | undefined;
    let videoList: ChatVideoItem[] | undefined;
    let fileList: ChatFileItem[] | undefined;

    if (files && files.length > 0) {
      fileIds = [];
      imageList = [];
      videoList = [];
      fileList = [];
      const documentService = new DocumentService(this.db, this.userId);

      for (const file of files) {
        await throwIfExecutionAborted('file upload');

        try {
          const result = await ingestAttachment(file, fileService, this.userId);
          fileIds.push(result.fileId);

          if (result.isImage) {
            imageList.push({
              alt: file.name || 'image',
              id: result.fileId,
              url: result.resolvedUrl,
            });
            continue;
          }

          if (result.isVideo) {
            videoList.push({
              alt: file.name || 'video',
              id: result.fileId,
              url: result.resolvedUrl,
            });
            continue;
          }

          // Non-image / non-video: parse file content into the documents table so
          // the MessageContentProcessor can inject it via filesPrompts(). Mirrors
          // what the web upload path does, ensuring bot-uploaded PDFs / text /
          // JSON / .skill files are actually visible to the LLM (instead of
          // being silently uploaded but never read).
          let content: string | undefined;
          try {
            const document = await documentService.parseFile(result.fileId);
            content = document.content ?? undefined;
          } catch (parseError) {
            log(
              'execAgent: parseFile failed for %s (fileId=%s): %O',
              file.name,
              result.fileId,
              parseError,
            );
            warnings.push(
              `File "${file.name || 'unknown'}" was uploaded but its contents could not be extracted.`,
            );
          }

          fileList.push({
            content,
            fileType: file.mimeType ?? 'application/octet-stream',
            id: result.fileId,
            name: file.name ?? 'file',
            size: file.size ?? 0,
            url: result.resolvedUrl || '',
          });
        } catch (error) {
          log('execAgent: failed to ingest file %s: %O', file.name || file.url, error);
          warnings.push(`File "${file.name || 'unknown'}" could not be uploaded and was skipped.`);
        }
      }

      if (fileIds.length > 0) {
        log(
          'execAgent: uploaded %d files to S3 (%d images, %d videos, %d documents)',
          fileIds.length,
          imageList.length,
          videoList.length,
          fileList.length,
        );
      }
      if (imageList.length === 0) imageList = undefined;
      if (videoList.length === 0) videoList = undefined;
      if (fileList.length === 0) fileList = undefined;
    }

    // 13b. Attach already-uploaded files referenced by fileIds (e.g. SPA Gateway mode).
    // These files are already in the `files` table; resolve URLs + classify, and
    // merge into the imageList/videoList/fileList passed to the LLM and stored
    // as message relations via messagesFiles.
    if (attachedFileIds && attachedFileIds.length > 0) {
      await throwIfExecutionAborted('file resolution');

      // Dedupe while preserving caller order. messages_files has a composite PK
      // on (file_id, message_id), so duplicate fileIds would violate the
      // constraint on messageModel.create and abort the whole send.
      const dedupedFileIds = Array.from(new Set(attachedFileIds));

      const fileModel = new FileModel(this.db, this.userId);
      const fileRecords = await fileModel.findByIds(dedupedFileIds);

      if (fileRecords.length > 0) {
        fileIds = fileIds ?? [];
        imageList = imageList ?? [];
        videoList = videoList ?? [];
        fileList = fileList ?? [];

        const documentService = new DocumentService(this.db, this.userId);

        // Preserve caller's ordering of fileIds so rendering matches upload order.
        const recordById = new Map(fileRecords.map((f) => [f.id, f]));

        for (const id of dedupedFileIds) {
          const file = recordById.get(id);
          if (!file) {
            warnings.push(`Attachment "${id}" was not found and skipped.`);
            continue;
          }

          fileIds.push(file.id);
          const resolvedUrl = (await fileService.getFullFileUrl(file.url)) || file.url;
          const fileType = file.fileType || '';

          if (fileType.startsWith('image')) {
            imageList.push({
              alt: file.name || 'image',
              id: file.id,
              url: resolvedUrl,
            });
            continue;
          }

          if (fileType.startsWith('video')) {
            videoList.push({
              alt: file.name || 'video',
              id: file.id,
              url: resolvedUrl,
            });
            continue;
          }

          // Non-image / non-video: ensure the document content is parsed so
          // MessageContentProcessor can inject it via filesPrompts(). parseFile
          // is idempotent — returns cached content when the document already exists.
          let content: string | undefined;
          try {
            const document = await documentService.parseFile(file.id);
            content = document.content ?? undefined;
          } catch (parseError) {
            log(
              'execAgent: parseFile failed for attached file %s (id=%s): %O',
              file.name,
              file.id,
              parseError,
            );
            warnings.push(
              `File "${file.name || 'unknown'}" was attached but its contents could not be extracted.`,
            );
          }

          fileList.push({
            content,
            fileType: fileType || 'application/octet-stream',
            id: file.id,
            name: file.name || 'file',
            size: file.size ?? 0,
            url: resolvedUrl,
          });
        }

        log(
          'execAgent: resolved %d attached file(s) (%d images, %d videos, %d documents)',
          fileRecords.length,
          imageList.length,
          videoList.length,
          fileList.length,
        );

        if (imageList.length === 0) imageList = undefined;
        if (videoList.length === 0) videoList = undefined;
        if (fileList.length === 0) fileList = undefined;
      } else {
        log('execAgent: no file records found for attachedFileIds=%O', dedupedFileIds);
      }
    }

    await throwIfExecutionAborted('message creation');

    // 13. Create user message in database
    // Include threadId if provided (for SubAgent task execution in isolated Thread)
    const userMessageRecord = effectiveResume
      ? undefined
      : await this.messageModel.create({
          agentId: resolvedAgentId,
          content: prompt,
          files: fileIds,
          role: 'user',
          threadId: appContext?.threadId ?? undefined,
          topicId,
        });
    if (userMessageRecord) {
      log('execAgent: created user message %s', userMessageRecord.id);
    }

    // 14. Create assistant message placeholder in database
    // Include threadId if provided (for SubAgent task execution in isolated Thread)
    const assistantMessageRecord = await this.messageModel.create({
      agentId: resolvedAgentId,
      content: LOADING_FLAT,
      model,
      parentId: parentMessageId ?? userMessageRecord?.id,
      provider,
      role: 'assistant',
      threadId: appContext?.threadId ?? undefined,
      topicId,
    });
    log('execAgent: created assistant message %s', assistantMessageRecord.id);
    assistantMessageRef.current = assistantMessageRecord.id;

    // Append Phase 2 warnings (ingestion/parsing errors) to botPlatformContext
    // so the context engine can inject them alongside Phase 1 warnings
    if (warnings.length > 0 && botPlatformContext) {
      const existing = (botPlatformContext as any).warnings as string[] | undefined;
      (botPlatformContext as any).warnings = [...(existing ?? []), ...warnings];
    }

    // Create user message object for processing.
    // - imageList: vision models render these as image_url parts
    // - videoList: video-capable models render these as video parts
    // - fileList: MessageContentProcessor injects content via filesPrompts() XML
    const userMessage = {
      content: prompt,
      fileList,
      imageList,
      role: 'user' as const,
      videoList,
    };

    // Combine history messages with user message
    const allMessages = effectiveResume ? historyMessages : [...historyMessages, userMessage];

    log('execAgent: prepared evalContext for executor');

    await throwIfExecutionAborted('operation preparation');

    // 15. Generate operation ID: agt_{timestamp}_{agentId}_{topicId}_{random}
    const timestamp = Date.now();
    const operationId = `op_${timestamp}_${resolvedAgentId}_${topicId}_${nanoid(8)}`;

    // 16. Create initial context
    let initialContext: AgentRuntimeContext = {
      payload: {
        // Pass assistant message ID so agent runtime knows which message to update
        assistantMessageId: assistantMessageRecord.id,
        isFirstMessage: true,
        message: effectiveResume ? [{ content: '' }] : [{ content: prompt }],
        // Pass user message ID as parentMessageId for reference
        parentMessageId: parentMessageId ?? userMessageRecord?.id ?? '',
        // Include tools for initial LLM call
        tools,
      },
      phase: 'user_input' as const,
      session: {
        messageCount: allMessages.length,
        sessionId: operationId,
        status: 'idle' as const,
        stepCount: 0,
      },
    };

    if (appContext?.scope !== 'page' && appContext?.documentId && topicId) {
      try {
        const topicDocuments = await this.agentDocumentsService.listDocumentsForTopic(
          resolvedAgentId,
          topicId,
        );
        const activeTopicDocument = topicDocuments.find(
          (document) => document.documentId === appContext.documentId,
        );

        initialContext = {
          ...initialContext,
          initialContext: {
            activeTopicDocument: {
              agentDocumentId: activeTopicDocument?.id,
              documentId: appContext.documentId,
              title: activeTopicDocument?.title,
            },
          },
        };
      } catch (error) {
        log('execAgent: failed to resolve active topic document context: %O', error);
        initialContext = {
          ...initialContext,
          initialContext: {
            activeTopicDocument: {
              documentId: appContext.documentId,
            },
          },
        };
      }
    }

    // 16b. Human-approval resume — override initialContext based on the
    // user's decision. The DB write above has already persisted the
    // intervention status, so `allMessages` reflects the decision for the
    // LLM / runner on the first step.
    //
    // `rejected` and `rejected_continue` share the same server-side path:
    // both surface the rejection to the LLM as user feedback via
    // `phase: 'user_input'`. The client-side split (halt vs. continue) is
    // only about the UX of the button and the optimistic writes — once the
    // decision is persisted, there's nothing meaningful to do differently
    // server-side, and letting the LLM produce a brief acknowledgement keeps
    // the conversation cleanly terminated either way.
    if (resumeApproval && resumeApprovalPlugin) {
      if (resumeApproval.decision === 'approved') {
        // Ask the runtime to execute the approved tool directly. Matches the
        // `phase: 'human_approved_tool'` contract used by the in-place
        // handleHumanIntervention flow — the runner generates a `call_tool`
        // instruction keyed on this payload. All tool metadata comes from
        // the plugin row fetched above; missing any of identifier/apiName
        // breaks the server-side tool executor dispatch.
        initialContext = {
          initialContext: initialContext.initialContext,
          payload: {
            approvedToolCall: {
              apiName: resumeApprovalPlugin.apiName,
              arguments: resumeApprovalPlugin.arguments,
              id: resumeApproval.toolCallId,
              identifier: resumeApprovalPlugin.identifier,
              type: resumeApprovalPlugin.type ?? 'default',
            },
            assistantMessageId: assistantMessageRecord.id,
            parentMessageId: resumeApproval.parentMessageId,
            skipCreateToolMessage: true,
          } as any,
          phase: 'human_approved_tool' as const,
          session: {
            messageCount: allMessages.length,
            sessionId: operationId,
            status: 'idle' as const,
            stepCount: 0,
          },
        };
      } else {
        initialContext = {
          ...initialContext,
          payload: {
            ...(initialContext.payload as any),
            isFirstMessage: false,
            message: [{ content: '' }],
            parentMessageId: resumeApproval.parentMessageId,
          },
        };
      }
    }

    // 17. Log final operation parameters summary
    log(
      'execAgent: creating operation %s with params: model=%s, provider=%s, tools=%d, messages=%d, manifests=%d',
      operationId,
      model,
      provider,
      tools?.length ?? 0,
      allMessages.length,
      Object.keys(toolManifestMap).length,
    );

    // 18. Build OperationSkillSet via SkillEngine
    // Combines builtin skills + user DB skills, filters by platform via enableChecker,
    // and pairs with agent's enabled plugin IDs for downstream SkillResolver consumption.
    let operationSkillSet;
    try {
      const builtinMetas = builtinSkills.map((s) => ({
        content: s.content,
        description: s.description,
        identifier: s.identifier,
        name: s.name,
      }));
      const skillModel = new AgentSkillModel(this.db, this.userId);
      const { data: dbSkills } = await skillModel.findAll();
      const dbMetas = dbSkills.map((s) => ({
        description: s.description ?? '',
        identifier: s.identifier,
        name: s.name,
      }));

      const skillEngine = new SkillEngine({
        enableChecker: (skill) => shouldEnableBuiltinSkill(skill.identifier),
        skills: [...builtinMetas, ...dbMetas],
      });
      operationSkillSet = skillEngine.generate(agentPlugins ?? []);
    } catch (error) {
      log('execAgent: failed to build operationSkillSet: %O', error);
    }

    // 19. Create operation using AgentRuntimeService
    log(
      'execAgent: creating operation %s — agentDocuments=%d, knowledgeBases=%s, tools=%d, skills=%d',
      operationId,
      hasAgentDocuments ? 'yes' : 0,
      hasEnabledKnowledgeBases,
      tools?.length ?? 0,
      operationSkillSet?.skills?.length ?? 0,
    );

    // Wrap in try-catch to handle operation startup failures (e.g., QStash unavailable)
    // If createOperation fails, we still have valid messages that need error info
    try {
      const result = await this.agentRuntimeService.createOperation({
        activeDeviceId,
        agentConfig,
        deviceSystemInfo: Object.keys(deviceSystemInfo).length > 0 ? deviceSystemInfo : undefined,
        userTimezone,
        appContext: {
          agentId: resolvedAgentId,
          documentId: appContext?.documentId,
          groupId: appContext?.groupId,
          scope: appContext?.scope,
          taskId,
          threadId: appContext?.threadId,
          topicId,
          trigger,
        },
        autoStart,
        botPlatformContext,
        discordContext,
        evalContext,
        initialContext,
        initialMessages: allMessages,
        initialStepCount,
        maxSteps,
        modelRuntimeConfig: { model, provider },
        hooks,
        operationId,
        signal,
        queueRetries,
        queueRetryDelay,
        stream,
        toolSet: {
          enabledToolIds: toolsResult.enabledToolIds,
          executorMap: toolExecutorMap,
          manifestMap: toolManifestMap,
          sourceMap: toolSourceMap,
          tools,
        },
        operationSkillSet,
        userId: this.userId,
        userInterventionConfig,
        userMemory,
      });

      log('execAgent: created operation %s (autoStarted: %s)', operationId, result.autoStarted);

      // Persist running operation to topic metadata for reconnect after page reload
      await this.topicModel.updateMetadata(topicId, {
        runningOperation: {
          assistantMessageId: assistantMessageRecord.id,
          operationId,
          scope: appContext?.scope ?? undefined,
          threadId: appContext?.threadId ?? undefined,
        },
      });

      // Generate a short-lived JWT for Gateway WebSocket authentication
      let gatewayToken: string | undefined;
      try {
        gatewayToken = await signUserJWT(this.userId);
      } catch {
        log('execAgent: failed to sign gateway JWT, gateway auth will be unavailable');
      }

      return {
        agentId: resolvedAgentId,
        assistantMessageId: assistantMessageRecord.id,
        autoStarted: result.autoStarted,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: result.messageId,
        operationId,
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        token: gatewayToken,
        topicId,
        userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
      };
    } catch (error) {
      if (isAbortError(error)) {
        await updateAbortedAssistantMessage(error.message);
        log('execAgent: createOperation aborted for %s: %s', operationId, error.message);
        throw error;
      }

      // Operation startup failed (e.g., QStash queue service unavailable)
      // Update assistant message with error so user can see what went wrong
      const errorMessage = error instanceof Error ? error.message : 'Unknown error starting agent';
      log(
        'execAgent: createOperation failed, updating assistant message with error: %s',
        errorMessage,
      );

      await this.messageModel.update(assistantMessageRecord.id, {
        content: '',
        error: {
          body: {
            detail: errorMessage,
          },
          message: errorMessage,
          type: 'ServerAgentRuntimeError', // ServiceUnavailable - agent runtime service unavailable
        },
      });

      // Return result with error status - messages are valid but agent didn't start
      return {
        agentId: resolvedAgentId,
        assistantMessageId: assistantMessageRecord.id,
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: errorMessage,
        message: 'Agent operation failed to start',
        operationId,
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId,
        userMessageId: userMessageRecord?.id ?? parentMessageId ?? '',
      };
    }
  }

  /**
   * Execute Group Agent (Supervisor) in a single call
   *
   * This method handles Group-specific logic (topic with groupId) and delegates
   * the core agent execution to execAgent.
   *
   * Flow:
   * 1. Create topic with groupId (if needed)
   * 2. Delegate to execAgent for the rest
   */
  async execGroupAgent(params: ExecGroupAgentParams): Promise<ExecGroupAgentResult> {
    const { agentId, groupId, message, topicId: inputTopicId, newTopic } = params;

    log(
      'execGroupAgent: agentId=%s, groupId=%s, message=%s',
      agentId,
      groupId,
      message.slice(0, 50),
    );

    // 1. Create topic with groupId if needed
    let topicId = inputTopicId;
    let isCreateNewTopic = false;

    // Create new topic when:
    // - newTopic is explicitly provided, OR
    // - no topicId is provided (default behavior for group chat)
    if (newTopic || !inputTopicId) {
      const topicTitle =
        newTopic?.title || message.slice(0, 50) + (message.length > 50 ? '...' : '');
      const topicItem = await this.topicModel.create({
        agentId,
        groupId,
        messages: newTopic?.topicMessageIds,
        title: topicTitle,
        // Note: execGroupAgent doesn't have trigger param yet, defaults to null
      });
      topicId = topicItem.id;
      isCreateNewTopic = true;
      log('execGroupAgent: created new topic %s with groupId %s', topicId, groupId);
    }

    // 2. Delegate to execAgent with groupId in appContext
    const result = await this.execAgent({
      agentId,
      appContext: { groupId, topicId },
      autoStart: true,
      prompt: message,
    });

    log(
      'execGroupAgent: delegated to execAgent, operationId=%s, success=%s',
      result.operationId,
      result.success,
    );

    return {
      assistantMessageId: result.assistantMessageId,
      error: result.error,
      isCreateNewTopic,
      operationId: result.operationId,
      success: result.success,
      topicId: result.topicId,
      userMessageId: result.userMessageId,
    };
  }

  /**
   * Execute SubAgent task (supports both Group and Single Agent mode)
   *
   * This method is called by Supervisor (Group mode) or Agent (Single mode)
   * to delegate tasks to SubAgents. Each task runs in an isolated Thread context.
   *
   * - Group mode: pass groupId, Thread will be associated with the Group
   * - Single Agent mode: omit groupId, Thread will only be associated with the Agent
   *
   * Flow:
   * 1. Create Thread (type='isolation', status='processing')
   * 2. Delegate to execAgent with threadId in appContext
   * 3. Store operationId in Thread metadata
   */
  async execSubAgentTask(params: ExecSubAgentTaskParams): Promise<ExecSubAgentTaskResult> {
    const { groupId, topicId, parentMessageId, agentId, instruction, title, parentOperationId } =
      params;

    log(
      'execSubAgentTask: agentId=%s, groupId=%s, topicId=%s, instruction=%s',
      agentId,
      groupId,
      topicId,
      instruction.slice(0, 50),
    );

    // Dispatch beforeCallAgent hook on parent operation
    if (parentOperationId) {
      hookDispatcher
        .dispatch(parentOperationId, 'beforeCallAgent', {
          agentId,
          instruction: instruction.slice(0, 200),
          operationId: parentOperationId,
          userId: this.userId,
        })
        .catch(() => {});
    }

    // 1. Create Thread for isolated task execution
    const thread = await this.threadModel.create({
      agentId,
      groupId,
      sourceMessageId: parentMessageId,
      title,
      topicId,
      type: ThreadType.Isolation,
    });

    if (!thread) {
      throw new Error('Failed to create thread for task execution');
    }

    log('execSubAgentTask: created thread %s', thread.id);

    // 2. Update Thread status to processing with startedAt timestamp
    const startedAt = new Date().toISOString();
    await this.threadModel.update(thread.id, {
      metadata: { startedAt },
      status: ThreadStatus.Processing,
    });

    // 3. Create hooks for updating Thread metadata and task message
    const threadHooks = this.createThreadHooks(thread.id, startedAt, parentMessageId);

    // 4. Delegate to execAgent with threadId in appContext and hooks
    // The instruction will be created as user message in the Thread
    // Use headless mode to skip human approval in async task execution
    const result = await this.execAgent({
      agentId,
      appContext: { groupId, threadId: thread.id, topicId },
      autoStart: true,
      hooks: threadHooks,
      prompt: instruction,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    log(
      'execSubAgentTask: delegated to execAgent, operationId=%s, success=%s',
      result.operationId,
      result.success,
    );

    // 5. Store operationId in Thread metadata
    await this.threadModel.update(thread.id, {
      metadata: { operationId: result.operationId, startedAt },
    });

    // 6. If operation failed to start, update thread status
    if (!result.success) {
      const completedAt = new Date().toISOString();
      await this.threadModel.update(thread.id, {
        metadata: {
          completedAt,
          duration: Date.now() - new Date(startedAt).getTime(),
          error: result.error,
          operationId: result.operationId,
          startedAt,
        },
        status: ThreadStatus.Failed,
      });

      // Dispatch onCallAgentError hook
      if (parentOperationId) {
        hookDispatcher
          .dispatch(parentOperationId, 'onCallAgentError', {
            agentId,
            error: result.error || 'Sub-agent execution failed',
            operationId: parentOperationId,
            userId: this.userId,
          })
          .catch(() => {});
      }
    } else if (parentOperationId) {
      // Dispatch afterCallAgent hook
      hookDispatcher
        .dispatch(parentOperationId, 'afterCallAgent', {
          agentId,
          operationId: parentOperationId,
          subOperationId: result.operationId,
          success: true,
          threadId: thread.id,
          userId: this.userId,
        })
        .catch(() => {});
    }

    return {
      assistantMessageId: result.assistantMessageId,
      error: result.error,
      operationId: result.operationId,
      success: result.success ?? false,
      threadId: thread.id,
    };
  }

  /**
   * Create step lifecycle callbacks for updating Thread metadata
   * These callbacks accumulate metrics during execution and update Thread on completion
   *
   * @param threadId - The Thread ID to update
   * @param startedAt - The start time ISO string
   * @param sourceMessageId - The task message ID (sourceMessageId from Thread) to update with summary
   */
  private createThreadMetadataCallbacks(
    threadId: string,
    startedAt: string,
    sourceMessageId: string,
  ): StepLifecycleCallbacks {
    // Accumulator for tracking metrics across steps
    let accumulatedToolCalls = 0;

    return {
      onAfterStep: async ({ state, stepResult }) => {
        // Count tool calls from this step
        const toolCallsInStep = stepResult?.events?.filter(
          (e: { type: string }) => e.type === 'tool_call',
        )?.length;
        if (toolCallsInStep) {
          accumulatedToolCalls += toolCallsInStep;
        }

        // Update Thread metadata with current progress
        try {
          await this.threadModel.update(threadId, {
            metadata: {
              operationId: state.operationId,
              startedAt,
              totalMessages: state.messages?.length ?? 0,
              totalTokens: this.calculateTotalTokens(state.usage),
              totalToolCalls: accumulatedToolCalls,
            },
          });
          log(
            'execSubAgentTask: updated thread %s metadata after step %d',
            threadId,
            state.stepCount,
          );
        } catch (error) {
          log('execSubAgentTask: failed to update thread metadata: %O', error);
        }
      },

      onComplete: async ({ finalState, reason }) => {
        const completedAt = new Date().toISOString();
        const duration = Date.now() - new Date(startedAt).getTime();

        // Determine thread status based on completion reason
        let status: ThreadStatus;
        switch (reason) {
          case 'done': {
            status = ThreadStatus.Completed;
            break;
          }
          case 'error': {
            status = ThreadStatus.Failed;
            break;
          }
          case 'interrupted': {
            status = ThreadStatus.Cancel;
            break;
          }
          case 'waiting_for_human': {
            status = ThreadStatus.InReview;
            break;
          }
          default: {
            status = ThreadStatus.Completed;
          }
        }

        // Log error when task fails
        if (reason === 'error' && finalState.error) {
          console.error('execSubAgentTask: task failed for thread %s:', threadId, finalState.error);
        }

        try {
          // Extract summary from last assistant message and update task message content
          const lastAssistantMessage = finalState.messages
            ?.slice()
            .reverse()
            .find((m: { role: string }) => m.role === 'assistant');

          if (lastAssistantMessage?.content) {
            await this.messageModel.update(sourceMessageId, {
              content: lastAssistantMessage.content,
            });
            log('execSubAgentTask: updated task message %s with summary', sourceMessageId);
          }

          // Format error for proper serialization (Error objects don't serialize with JSON.stringify)
          const formattedError = formatErrorForMetadata(finalState.error);

          // Update Thread metadata
          await this.threadModel.update(threadId, {
            metadata: {
              completedAt,
              duration,
              error: formattedError,
              operationId: finalState.operationId,
              startedAt,
              totalCost: finalState.cost?.total,
              totalMessages: finalState.messages?.length ?? 0,
              totalTokens: this.calculateTotalTokens(finalState.usage),
              totalToolCalls: accumulatedToolCalls,
            },
            status,
          });

          log(
            'execSubAgentTask: thread %s completed with status %s, reason: %s',
            threadId,
            status,
            reason,
          );
        } catch (error) {
          console.error('execSubAgentTask: failed to update thread on completion: %O', error);
        }
      },
    };
  }

  /**
   * Create hooks for tracking Thread metadata updates during SubAgent execution.
   * Replaces the legacy createThreadMetadataCallbacks with the hooks system.
   */
  private createThreadHooks(
    threadId: string,
    startedAt: string,
    sourceMessageId: string,
  ): AgentHook[] {
    let accumulatedToolCalls = 0;

    return [
      {
        handler: async (event) => {
          const state = event.finalState;
          if (!state) return;

          // Count tool calls from step result
          const stepToolCalls = state.session?.toolCalls || 0;
          if (stepToolCalls > accumulatedToolCalls) {
            accumulatedToolCalls = stepToolCalls;
          }

          try {
            await this.threadModel.update(threadId, {
              metadata: {
                operationId: event.operationId,
                startedAt,
                totalMessages: state.messages?.length ?? 0,
                totalTokens: this.calculateTotalTokens(state.usage),
                totalToolCalls: accumulatedToolCalls,
              },
            });
          } catch (error) {
            log('Thread hook afterStep: failed to update metadata: %O', error);
          }
        },
        id: 'thread-metadata-update',
        type: 'afterStep' as const,
      },
      {
        handler: async (event) => {
          const finalState = event.finalState;
          if (!finalState) return;

          const completedAt = new Date().toISOString();
          const duration = Date.now() - new Date(startedAt).getTime();

          // Map completion reason to ThreadStatus
          let status: ThreadStatus;
          switch (event.reason) {
            case 'done': {
              status = ThreadStatus.Completed;
              break;
            }
            case 'error': {
              status = ThreadStatus.Failed;
              break;
            }
            case 'interrupted': {
              status = ThreadStatus.Cancel;
              break;
            }
            case 'waiting_for_human': {
              status = ThreadStatus.InReview;
              break;
            }
            default: {
              status = ThreadStatus.Completed;
            }
          }

          if (event.reason === 'error' && finalState.error) {
            console.error(
              'Thread hook onComplete: task failed for thread %s:',
              threadId,
              finalState.error,
            );
          }

          try {
            // Update task message with summary
            const lastAssistantMessage = finalState.messages
              ?.slice()
              .reverse()
              .find((m: { role: string }) => m.role === 'assistant');

            if (lastAssistantMessage?.content) {
              await this.messageModel.update(sourceMessageId, {
                content: lastAssistantMessage.content,
              });
            }

            const formattedError = formatErrorForMetadata(finalState.error);

            await this.threadModel.update(threadId, {
              metadata: {
                completedAt,
                duration,
                error: formattedError,
                operationId: finalState.operationId,
                startedAt,
                totalCost: finalState.cost?.total,
                totalMessages: finalState.messages?.length ?? 0,
                totalTokens: this.calculateTotalTokens(finalState.usage),
                totalToolCalls: accumulatedToolCalls,
              },
              status,
            });

            log(
              'Thread hook onComplete: thread %s status=%s reason=%s',
              threadId,
              status,
              event.reason,
            );
          } catch (error) {
            console.error('Thread hook onComplete: failed to update: %O', error);
          }
        },
        id: 'thread-completion',
        type: 'onComplete' as const,
      },
    ];
  }

  /**
   * Calculate total tokens from AgentState usage object
   * AgentState.usage is of type Usage from @lobechat/agent-runtime
   */
  private calculateTotalTokens(usage?: AgentState['usage']): number | undefined {
    if (!usage) return undefined;
    return usage.llm?.tokens?.total;
  }

  /**
   * Interrupt a running task
   *
   * This method interrupts a SubAgent task by threadId or operationId.
   * It updates both operation status and Thread status to cancelled state.
   */
  async interruptTask(params: {
    operationId?: string;
    threadId?: string;
  }): Promise<{ operationId?: string; success: boolean; threadId?: string }> {
    const { threadId, operationId } = params;

    log('interruptTask: threadId=%s, operationId=%s', threadId, operationId);

    // 1. Get operationId and thread
    let resolvedOperationId = operationId;
    let thread;

    if (threadId) {
      thread = await this.threadModel.findById(threadId);
      if (!thread) {
        throw new Error('Thread not found');
      }
      resolvedOperationId = resolvedOperationId || thread.metadata?.operationId;
    }

    if (!resolvedOperationId) {
      throw new Error('Operation ID not found');
    }

    // 2. Interrupt the runtime operation first. Only mark the thread cancelled
    // after the runtime acknowledges the interrupt to avoid unlocking a live task.
    const interrupted = await this.agentRuntimeService.interruptOperation(resolvedOperationId);
    log(
      'interruptTask: interruptOperation=%s for operationId=%s',
      interrupted,
      resolvedOperationId,
    );

    if (!interrupted) {
      const alreadyCancelled = thread?.status === ThreadStatus.Cancel;

      return {
        operationId: resolvedOperationId,
        success: alreadyCancelled,
        threadId: thread?.id,
      };
    }

    // 3. Update Thread status to cancel
    if (thread) {
      await this.threadModel.update(thread.id, {
        metadata: {
          ...thread.metadata,
          completedAt: new Date().toISOString(),
        },
        status: ThreadStatus.Cancel,
      });
    }

    return {
      operationId: resolvedOperationId,
      success: true,
      threadId: thread?.id,
    };
  }
}
