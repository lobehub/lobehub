import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import { BUILTIN_AGENT_SLUGS, getAgentRuntimeConfig } from '@lobechat/builtin-agents';
import { builtinSkills } from '@lobechat/builtin-skills';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import {
  type DeviceAttachment,
  generateSystemPrompt,
  RemoteDeviceManifest,
} from '@lobechat/builtin-tool-remote-device';
import { builtinTools, manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import { LOADING_FLAT } from '@lobechat/const';
import type { LobeToolManifest } from '@lobechat/context-engine';
import { SkillEngine } from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import type {
  ChatTopicBotContext,
  ExecAgentParams,
  ExecAgentResult,
  ExecGroupAgentParams,
  ExecGroupAgentResult,
  ExecSubAgentTaskParams,
  ExecSubAgentTaskResult,
  UserInterventionConfig,
} from '@lobechat/types';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { AiModelModel } from '@/database/models/aiModel';
import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { shouldEnableBuiltinSkill } from '@/helpers/skillFilters';
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
import { type AgentHook } from '@/server/services/agentRuntime/hooks/types';
import { type StepLifecycleCallbacks } from '@/server/services/agentRuntime/types';
import { FileService } from '@/server/services/file';
import { KlavisService } from '@/server/services/klavis';
import { MarketService } from '@/server/services/market';
import { deviceProxy } from '@/server/services/toolExecution/deviceProxy';

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
  /**
   * Completion webhook configuration
   * Persisted in Redis state, triggered via HTTP POST when the operation completes.
   */
  completionWebhook?: {
    body?: Record<string, unknown>;
    url: string;
  };
  /** Cron job ID that triggered this execution (if trigger is 'cron') */
  cronJobId?: string;
  /** Discord context for injecting channel/guild info into agent system message */
  discordContext?: any;
  /** Eval context for injecting environment prompts into system message */
  evalContext?: EvalContext;
  /** External file URLs to download, upload to S3, and attach to the user message */
  files?: Array<{
    mimeType?: string;
    name?: string;
    size?: number;
    url: string;
  }>;
  /** External lifecycle hooks (auto-adapt to local/production mode) */
  hooks?: AgentHook[];
  /** Maximum steps for the agent operation */
  maxSteps?: number;
  /** Abort startup before the agent runtime operation is created */
  signal?: AbortSignal;
  /** Step lifecycle callbacks for operation tracking (server-side only) */
  stepCallbacks?: StepLifecycleCallbacks;
  /**
   * Step webhook configuration
   * Persisted in Redis state, triggered via HTTP POST after each step completes.
   */
  stepWebhook?: {
    body?: Record<string, unknown>;
    url: string;
  };
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
  /**
   * Webhook delivery method.
   * - 'fetch': plain HTTP POST (default)
   * - 'qstash': deliver via QStash publishJSON for guaranteed delivery
   */
  webhookDelivery?: 'fetch' | 'qstash';
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
      botPlatformContext,
      discordContext,
      existingMessageIds = [],
      files,
      hooks,
      instructions,
      stepCallbacks,
      stream,
      title,
      trigger,
      cronJobId,
      taskId,
      evalContext,
      maxSteps,
      signal,
      userInterventionConfig,
      completionWebhook,
      stepWebhook,
      webhookDelivery,
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

    await throwIfExecutionAborted('agent configuration');

    // 2.5. Append additional instructions to agent's systemRole
    if (instructions) {
      agentConfig.systemRole = agentConfig.systemRole
        ? `${agentConfig.systemRole}\n\n${instructions}`
        : instructions;
      log('execAgent: appended additional instructions to systemRole');
    }

    // 3. Handle topic creation: if no topicId provided, create a new topic; otherwise reuse existing
    let topicId = appContext?.topicId;
    if (!topicId) {
      // Prepare metadata with cronJobId, taskId, and botContext if provided
      const metadata =
        cronJobId || taskId || botContext
          ? { bot: botContext, cronJobId: cronJobId || undefined, taskId: taskId || undefined }
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

    // 4. Get installed plugins from database
    const installedPlugins = await this.pluginModel.query();
    log('execAgent: got %d installed plugins', installedPlugins.length);

    // 5. Get model abilities from model-bank for function calling support check
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');
    const isModelSupportToolUse = (m: string, p: string) => {
      const info = LOBE_DEFAULT_MODEL_LIST.find((item) => item.id === m && item.providerId === p);
      return info?.abilities?.functionCall ?? true;
    };

    // 6. Fetch LobeHub Skills manifests (temporary solution until LOBE-3517 is implemented)
    let lobehubSkillManifests: LobeToolManifest[] = [];
    try {
      lobehubSkillManifests = await this.marketService.getLobehubSkillManifests();
    } catch (error) {
      log('execAgent: failed to fetch lobehub skill manifests: %O', error);
    }
    log('execAgent: got %d lobehub skill manifests', lobehubSkillManifests.length);

    // 7. Fetch Klavis tool manifests from database
    let klavisManifests: LobeToolManifest[] = [];
    try {
      klavisManifests = await this.klavisService.getKlavisManifests();
    } catch (error) {
      log('execAgent: failed to fetch klavis manifests: %O', error);
    }
    log('execAgent: got %d klavis manifests', klavisManifests.length);

    // 8. Fetch user settings (memory config + timezone)
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

    await throwIfExecutionAborted('tool discovery');

    // 9. Create tools using Server AgentToolsEngine
    const hasEnabledKnowledgeBases =
      agentConfig.knowledgeBases?.some((kb: { enabled?: boolean | null }) => kb.enabled === true) ??
      false;

    // Check if agent has documents (for auto-enabling agent-documents tool)
    let hasAgentDocuments = false;
    try {
      const docs = await this.agentDocumentsService.getAgentDocuments(resolvedAgentId);
      hasAgentDocuments = docs.length > 0;
    } catch {
      // Agent documents check is non-critical
    }

    // Build device context for ToolsEngine enableChecker
    const gatewayConfigured = deviceProxy.isConfigured;
    const boundDeviceId = agentConfig.agencyConfig?.boundDeviceId;
    let onlineDevices: DeviceAttachment[] = [];
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
    const agentPlugins = [
      ...(agentConfig?.plugins ?? []),
      ...(additionalPluginIds || []),
      ...(hasTopicReference ? ['lobe-topic-reference'] : []),
    ];

    // Derive activeDeviceId from device context:
    // 1. If agent has a bound device and it's online, use it
    // 2. In IM/Bot scenarios, auto-activate when exactly one device is online
    const activeDeviceId = boundDeviceId
      ? deviceOnline
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
      model,
      provider,
    });

    // Generate tools and manifest map
    // Include device tool IDs so ToolsEngine can process them via enableChecker
    const pluginIds = [
      ...(agentConfig.plugins || []),
      ...(additionalPluginIds || []),
      LocalSystemManifest.identifier,
      RemoteDeviceManifest.identifier,
    ];
    log('execAgent: agent configured plugins: %O', pluginIds);

    // When skillActivateMode is 'manual', exclude only discovery tools (lobe-activator, lobe-skill-store)
    // so that externally enabled tools (sandbox, web browsing, etc.) remain available
    const isManualMode = agentConfig.chatConfig?.skillActivateMode === 'manual';

    const toolsResult = toolsEngine.generateToolsDetailed({
      excludeDefaultToolIds: isManualMode ? manualModeExcludeToolIds : undefined,
      model,
      provider,
      toolIds: pluginIds,
    });

    const tools = toolsResult.tools;

    log('execAgent: enabled tool ids: %O', toolsResult.enabledToolIds);

    // Get manifest map and convert from Map to Record
    const manifestMap = toolsEngine.getEnabledPluginManifests(pluginIds);
    const toolManifestMap: Record<string, any> = {};
    manifestMap.forEach((manifest, id) => {
      toolManifestMap[id] = manifest;
    });

    // Build toolSourceMap for routing tool execution
    const toolSourceMap: Record<string, 'builtin' | 'plugin' | 'mcp' | 'klavis' | 'lobehubSkill'> =
      {};
    // Mark lobehub skills
    for (const manifest of lobehubSkillManifests) {
      toolSourceMap[manifest.identifier] = 'lobehubSkill';
    }
    // Mark klavis tools
    for (const manifest of klavisManifests) {
      toolSourceMap[manifest.identifier] = 'klavis';
    }

    log(
      'execAgent: generated %d tools from %d configured plugins, %d lobehub skills, %d klavis tools',
      tools?.length ?? 0,
      pluginIds.length,
      lobehubSkillManifests.length,
      klavisManifests.length,
    );

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

    // 9.5. Build Agent Management context if agent-management tool is enabled
    const isAgentManagementEnabled = toolsResult.enabledToolIds?.includes('lobe-agent-management');
    let agentManagementContext;
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

      agentManagementContext = {
        availablePlugins,
        // Limit to first 5 providers to avoid context bloat
        availableProviders: Array.from(providerMap.values()).slice(0, 5),
      };

      log(
        'execAgent: built agentManagementContext with %d providers and %d plugins',
        agentManagementContext.availableProviders.length,
        agentManagementContext.availablePlugins.length,
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
          topicId: appContext.topicId,
        },
        { postProcessUrl },
      );
    }

    await throwIfExecutionAborted('message history loading');

    // 12. Upload external files to S3 and collect file IDs
    let fileIds: string[] | undefined;
    let imageList: Array<{ alt: string; id: string; url: string }> | undefined;

    if (files && files.length > 0) {
      fileIds = [];
      imageList = [];

      for (const file of files) {
        await throwIfExecutionAborted('file upload');

        const ext = file.name?.split('.').pop() || 'bin';
        const pathname = `files/${this.userId}/${nanoid()}/${file.name || `file.${ext}`}`;

        try {
          const result = await fileService.uploadFromUrl(file.url, pathname);
          fileIds.push(result.fileId);

          // Build imageList for vision-capable models.
          // Use getFullFileUrl to resolve S3 key to a publicly accessible URL
          // (presigned or public domain), matching the frontend postProcessUrl pattern.
          const mimeType = file.mimeType || '';
          if (mimeType.startsWith('image/')) {
            const resolvedUrl = await fileService.getFullFileUrl(result.key);
            imageList.push({ alt: file.name || 'image', id: result.fileId, url: resolvedUrl });
          }
        } catch (error) {
          log('execAgent: failed to upload file %s: %O', file.url, error);

          // Fallback: if S3 upload failed but the file is an inline data URL image,
          // pass it directly to the LLM (vision models support data: URLs).
          const mimeType = file.mimeType || '';
          if (mimeType.startsWith('image/') && file.url.startsWith('data:')) {
            imageList.push({ alt: file.name || 'image', id: `inline_${nanoid()}`, url: file.url });
            log('execAgent: using inline data URL fallback for image');
          }
        }
      }

      if (fileIds.length > 0) {
        log('execAgent: uploaded %d files to S3', fileIds.length);
      }
      if (imageList.length === 0) imageList = undefined;
    }

    await throwIfExecutionAborted('message creation');

    // 13. Create user message in database
    // Include threadId if provided (for SubAgent task execution in isolated Thread)
    const userMessageRecord = await this.messageModel.create({
      agentId: resolvedAgentId,
      content: prompt,
      files: fileIds,
      role: 'user',
      threadId: appContext?.threadId ?? undefined,
      topicId,
    });
    log('execAgent: created user message %s', userMessageRecord.id);

    // 14. Create assistant message placeholder in database
    // Include threadId if provided (for SubAgent task execution in isolated Thread)
    const assistantMessageRecord = await this.messageModel.create({
      agentId: resolvedAgentId,
      content: LOADING_FLAT,
      model,
      parentId: userMessageRecord.id,
      provider,
      role: 'assistant',
      threadId: appContext?.threadId ?? undefined,
      topicId,
    });
    log('execAgent: created assistant message %s', assistantMessageRecord.id);
    assistantMessageRef.current = assistantMessageRecord.id;

    // Create user message object for processing (include imageList for vision models)
    const userMessage = { content: prompt, imageList, role: 'user' as const };

    // Combine history messages with user message
    const allMessages = [...historyMessages, userMessage];

    log('execAgent: prepared evalContext for executor');

    await throwIfExecutionAborted('operation preparation');

    // 15. Generate operation ID: agt_{timestamp}_{agentId}_{topicId}_{random}
    const timestamp = Date.now();
    const operationId = `op_${timestamp}_${resolvedAgentId}_${topicId}_${nanoid(8)}`;

    // 16. Create initial context
    const initialContext: AgentRuntimeContext = {
      payload: {
        // Pass assistant message ID so agent runtime knows which message to update
        assistantMessageId: assistantMessageRecord.id,
        isFirstMessage: true,
        message: [{ content: prompt }],
        // Pass user message ID as parentMessageId for reference
        parentMessageId: userMessageRecord.id,
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
          groupId: appContext?.groupId,
          taskId,
          threadId: appContext?.threadId,
          topicId,
          trigger,
        },
        autoStart,
        botPlatformContext,
        completionWebhook,
        discordContext,
        evalContext,
        initialContext,
        initialMessages: allMessages,
        maxSteps,
        modelRuntimeConfig: { model, provider },
        hooks,
        operationId,
        signal,
        stepCallbacks,
        stepWebhook,
        stream,
        toolSet: {
          enabledToolIds: toolsResult.enabledToolIds,
          manifestMap: toolManifestMap,
          sourceMap: toolSourceMap,
          tools,
        },
        operationSkillSet,
        userId: this.userId,
        userInterventionConfig,
        userMemory,
        webhookDelivery,
      });

      log('execAgent: created operation %s (autoStarted: %s)', operationId, result.autoStarted);

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
        topicId,
        userMessageId: userMessageRecord.id,
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
        userMessageId: userMessageRecord.id,
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
    const { groupId, topicId, parentMessageId, agentId, instruction, title } = params;

    log(
      'execSubAgentTask: agentId=%s, groupId=%s, topicId=%s, instruction=%s',
      agentId,
      groupId,
      topicId,
      instruction.slice(0, 50),
    );

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
