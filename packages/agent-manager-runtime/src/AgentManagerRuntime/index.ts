/**
 * Agent Manager Runtime
 *
 * Shared runtime for agent management operations used by both
 * builtin-tool-agent-builder and builtin-tool-agent-management.
 *
 * This runtime provides:
 * - Agent CRUD operations (create, update, delete)
 * - Agent search (user agents + marketplace)
 * - Model/Provider listing
 * - Plugin/Tool search and installation
 * - Prompt updates with streaming support
 *
 * Services must be injected via constructor for runtime-agnostic usage
 * (e.g., server-side services vs client-side services).
 */
import {
  marketToolsResultsPrompt,
  modelsResultsPrompt,
  searchAgentsResultsPrompt,
} from '@lobechat/prompts';
import {
  type BuiltinToolResult,
  type DiscoverAssistantDetail,
  getPluginMode,
  parsePluginEntry,
  upsertPluginMode,
} from '@lobechat/types';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors/selectors';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { getToolStoreState } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import { describeHeterogeneousAgent, renderHeteroRuntimeLines } from '../heteroAgentDescriptor';
import type {
  AgentManagerRuntimeServices,
  AgentSearchItem,
  AvailableModel,
  AvailableProvider,
  CreateAgentParams,
  CreateAgentState,
  DeleteAgentState,
  GetAvailableModelsParams,
  GetAvailableModelsState,
  IAgentService,
  IDiscoverService,
  InstallPluginParams,
  MarketToolItem,
  SearchAgentParams,
  SearchAgentState,
  SearchMarketToolsParams,
  SearchMarketToolsState,
  UpdateAgentConfigParams,
  UpdateAgentConfigState,
  UpdatePromptParams,
  UpdatePromptState,
} from '../types';
import { handleError, handleErrorWithState } from './errors';
import { ensureAgentLoaded, installPlugin } from './installPlugin';

/** Max results per searchAgents call (mirrored in the tool manifests: "max: 20") */
const MAX_SEARCH_AGENT_LIMIT = 20;

export class AgentManagerRuntime {
  /**
   * Preserve invocation order for prompt updates targeting the same agent,
   * including calls issued through different AgentManagerRuntime instances.
   */
  private static promptUpdateQueues = new Map<string, Promise<unknown>>();

  private agentService: IAgentService;
  private discoverService: IDiscoverService;

  /**
   * Create an AgentManagerRuntime instance
   * @param services - Required services for runtime operations
   */
  constructor(services: AgentManagerRuntimeServices) {
    this.agentService = services.agentService;
    this.discoverService = services.discoverService;
  }

  // ==================== Agent CRUD ====================

  /**
   * Create a new agent
   */
  async createAgent(params: CreateAgentParams): Promise<BuiltinToolResult> {
    try {
      // Guard against LLM double-encoding: if array fields are JSON strings, parse them.
      // Use `as any` to bypass TS narrowing — at runtime LLMs can send strings for typed array params.
      const parseArrayParam = (v: any): string[] | undefined => {
        if (typeof v === 'string') {
          try {
            return JSON.parse(v);
          } catch {
            return undefined;
          }
        }
        return v;
      };

      const config = {
        avatar: params.avatar,
        backgroundColor: params.backgroundColor,
        description: params.description,
        model: params.model,
        openingMessage: params.openingMessage,
        openingQuestions: parseArrayParam(params.openingQuestions),
        plugins: parseArrayParam(params.plugins),
        provider: params.provider,
        systemRole: params.systemRole,
        tags: parseArrayParam(params.tags),
        title: params.title,
      };

      const result = await this.agentService.createAgent({ config });

      return {
        content: `Successfully created agent "${params.title}" with ID: ${result.agentId}`,
        state: {
          agentId: result.agentId,
          success: true,
        } as CreateAgentState,
        success: true,
      };
    } catch (error) {
      return handleError(error, 'Failed to create agent');
    }
  }

  /**
   * Update agent configuration and/or metadata
   */
  async updateAgentConfig(
    agentId: string,
    params: UpdateAgentConfigParams,
  ): Promise<BuiltinToolResult> {
    try {
      // Ensure agent is loaded in store before reading its config
      await ensureAgentLoaded(this.agentService, agentId);

      const state = getAgentStoreState();
      const agentStore = getAgentStoreState();
      const resultState: UpdateAgentConfigState = { success: true };
      const contentParts: string[] = [];

      // Get current config for merging
      const previousConfig = agentSelectors.getAgentConfigById(agentId)(state);

      // Guard against LLM double-encoding: if config/meta is a JSON string, parse it.
      // Use `as any` to bypass TS narrowing — at runtime LLMs can send strings for
      // typed object params.
      let rawConfig: any = params.config;
      if (typeof rawConfig === 'string') {
        try {
          rawConfig = JSON.parse(rawConfig);
        } catch {
          rawConfig = undefined;
        }
      }
      let rawMeta: any = params.meta;
      if (typeof rawMeta === 'string') {
        try {
          rawMeta = JSON.parse(rawMeta);
        } catch {
          rawMeta = undefined;
        }
      }

      // Build the final config update, merging togglePlugin into config.plugins
      let finalConfig = rawConfig ? { ...rawConfig } : {};

      // Handle togglePlugin - merge into config.plugins
      if (params.togglePlugin) {
        const { pluginId, enabled } = params.togglePlugin;
        const isCurrentlyEnabled = getPluginMode(previousConfig?.plugins, pluginId) === 'pinned';
        const shouldEnable = enabled !== undefined ? enabled : !isCurrentlyEnabled;

        // upsertPluginMode preserves an already-matching entry as-is and
        // flips a disabled entry back to pinned in place, instead of
        // blindly pushing a duplicate bare-string identifier.
        const newPlugins = upsertPluginMode(
          previousConfig?.plugins,
          pluginId,
          shouldEnable ? 'pinned' : 'auto',
        );

        finalConfig = { ...finalConfig, plugins: newPlugins };

        resultState.togglePlugin = {
          enabled: shouldEnable,
          pluginId,
        };
        contentParts.push(`plugin ${pluginId} ${shouldEnable ? 'enabled' : 'disabled'}`);
      }

      // When systemRole is updated, clear editorData so the UI
      // doesn't show stale rich-text content that contradicts the new prompt
      if ('systemRole' in finalConfig && !('editorData' in finalConfig)) {
        finalConfig = { ...finalConfig, editorData: null };
      }

      // Handle config update
      if (Object.keys(finalConfig).length > 0) {
        const configUpdatedFields = Object.keys(finalConfig);
        const configPreviousValues: Record<string, unknown> = {};
        const configNewValues: Record<string, unknown> = {};

        for (const field of configUpdatedFields) {
          configPreviousValues[field] = (previousConfig as unknown as Record<string, unknown>)[
            field
          ];
          configNewValues[field] = (finalConfig as unknown as Record<string, unknown>)[field];
        }

        await agentStore.optimisticUpdateAgentConfig(agentId, finalConfig);

        const nonPluginFields = configUpdatedFields.filter((f) => f !== 'plugins');
        if (nonPluginFields.length > 0 || !params.togglePlugin) {
          resultState.config = {
            newValues: configNewValues,
            previousValues: configPreviousValues,
            updatedFields: configUpdatedFields,
          };
          if (!params.togglePlugin) {
            contentParts.push(`config fields: ${configUpdatedFields.join(', ')}`);
          } else if (nonPluginFields.length > 0) {
            contentParts.push(`config fields: ${nonPluginFields.join(', ')}`);
          }
        }
      }

      // Handle meta update
      if (rawMeta && Object.keys(rawMeta).length > 0) {
        const previousMeta = agentSelectors.getAgentMetaById(agentId)(state);
        const metaUpdatedFields = Object.keys(rawMeta);
        const metaPreviousValues: Record<string, unknown> = {};

        for (const field of metaUpdatedFields) {
          metaPreviousValues[field] = (previousMeta as unknown as Record<string, unknown>)[field];
        }

        await agentStore.optimisticUpdateAgentMeta(agentId, rawMeta);

        resultState.meta = {
          newValues: rawMeta,
          previousValues: metaPreviousValues as Record<string, unknown>,
          updatedFields: metaUpdatedFields,
        };
        contentParts.push(`meta fields: ${metaUpdatedFields.join(', ')}`);
      }

      if (contentParts.length === 0) {
        return {
          content: 'No fields to update.',
          state: { success: true } as UpdateAgentConfigState,
          success: true,
        };
      }

      const content = `Successfully updated agent. Updated ${contentParts.join('; ')}`;

      return {
        content,
        state: resultState,
        success: true,
      };
    } catch (error) {
      return handleError(error, 'Failed to update agent');
    }
  }

  /**
   * Delete an agent
   */
  async deleteAgent(agentId: string): Promise<BuiltinToolResult> {
    try {
      await this.agentService.removeAgent(agentId);

      return {
        content: `Successfully deleted agent ${agentId}`,
        state: {
          agentId,
          success: true,
        } as DeleteAgentState,
        success: true,
      };
    } catch (error) {
      return handleError(error, 'Failed to delete agent');
    }
  }

  /**
   * Get detailed agent configuration by ID
   */
  async getAgentDetail(agentId: string): Promise<BuiltinToolResult> {
    try {
      const config = await this.agentService.getAgentConfigById(agentId);

      if (!config) {
        // searchAgents can surface marketplace agents (short-code ids) that
        // have no local agents row; read their detail through the market
        // fallback instead of reporting a false "not found".
        const marketDetail = await this.getMarketAgentDetail(agentId);
        if (marketDetail) return marketDetail;

        return {
          content: `Agent "${agentId}" not found.`,
          success: false,
        };
      }

      // The merged config may contain extra fields from the DB agent row
      // (e.g., description, tags) that aren't on LobeAgentConfig type
      const raw = config as Record<string, any>;

      // Heterogeneous agents (Claude Code / Codex / …) bring their own toolset
      // and ignore the chat model/plugins. Surface a runtime descriptor so the
      // orchestrator can reason about what the external agent can actually do.
      const runtime = describeHeterogeneousAgent(config.agencyConfig);

      // Normalize to identifier strings (annotated with mode when not
      // pinned) — `config.plugins` is the raw AgentPluginEntry[] (string |
      // {identifier, mode}), but both the LLM-facing summary and the
      // GetAgentDetailState.config.plugins contract expect string[]. Passing
      // object-shaped entries through would break GetAgentDetailRender's
      // <Tag key={plugin}>{plugin}</Tag>.
      const pluginSummaries = config.plugins?.map((entry) => {
        const { identifier, mode } = parsePluginEntry(entry);
        return mode === 'pinned' ? identifier : `${identifier} (${mode})`;
      });

      const detail = {
        config: {
          model: config.model,
          openingMessage: config.openingMessage,
          openingQuestions: config.openingQuestions,
          plugins: pluginSummaries,
          provider: config.provider,
          ...(runtime && { runtime }),
          systemRole: config.systemRole,
        },
        meta: {
          avatar: config.avatar,
          backgroundColor: config.backgroundColor,
          description: raw.description as string | undefined,
          tags: raw.tags as string[] | undefined,
          title: config.title,
        },
      };

      const parts: string[] = [];
      if (detail.meta.title) parts.push(`**${detail.meta.title}**`);
      if (detail.meta.description) parts.push(detail.meta.description);
      if (detail.config.model)
        parts.push(`Model: ${detail.config.provider || ''}/${detail.config.model}`);
      if (detail.config.plugins?.length) {
        parts.push(`Plugins: ${detail.config.plugins.join(', ')}`);
      }
      parts.push(...renderHeteroRuntimeLines(runtime));
      if (detail.config.systemRole) {
        parts.push(`System Prompt: ${detail.config.systemRole}`);
      }

      return {
        content:
          parts.length > 0 ? parts.join('\n') : `Agent "${agentId}" found (no details available).`,
        state: {
          agentId,
          config: detail.config,
          meta: detail.meta,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      return handleError(error, 'Failed to get agent detail');
    }
  }

  /**
   * Duplicate an existing agent
   */
  async duplicateAgent(agentId: string, newTitle?: string): Promise<BuiltinToolResult> {
    try {
      const result = await this.agentService.duplicateAgent(agentId, newTitle);

      if (!result) {
        return {
          content: `Failed to duplicate agent "${agentId}". Agent may not exist.`,
          success: false,
        };
      }

      return {
        content: `Successfully duplicated agent. New agent ID: ${result.agentId}${newTitle ? ` with title "${newTitle}"` : ''}`,
        state: {
          newAgentId: result.agentId,
          sourceAgentId: agentId,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      return handleError(error, 'Failed to duplicate agent');
    }
  }

  // ==================== Search ====================

  /**
   * Search agents (user's own and marketplace)
   */
  async searchAgents(params: SearchAgentParams): Promise<BuiltinToolResult> {
    try {
      const source = params.source || 'all';
      const limit = Math.min(params.limit || 10, MAX_SEARCH_AGENT_LIMIT);
      const offset = Math.max(params.offset || 0, 0);
      const agents: AgentSearchItem[] = [];

      let userTotal = 0;
      let marketTotal = 0;

      // This is the CRUD surface: every id it returns can be forwarded to
      // `removeAgent`/`updateAgent`, and the inbox is product-owned. Opt it out
      // explicitly so the reserved assistant is never offered as a target here.
      if (source === 'user' || source === 'all') {
        const [userAgents, total] = await Promise.all([
          this.agentService.queryAgents({
            includeInbox: false,
            keyword: params.keyword,
            limit,
            offset,
          }),
          this.agentService.countAgents({ includeInbox: false, keyword: params.keyword }),
        ]);
        userTotal = total;

        agents.push(
          ...userAgents.map((agent) => ({
            avatar: agent.avatar ?? undefined,
            backgroundColor: agent.backgroundColor ?? undefined,
            description: agent.description ?? undefined,
            heteroType: agent.heteroType,
            id: agent.id,
            isMarket: false,
            name: agent.name ?? undefined,
            title: agent.title ?? undefined,
          })),
        );
      }

      // Search marketplace agents (first page only — offset does not apply)
      if (source === 'market' || source === 'all') {
        const marketAgents = await this.discoverService.getAssistantList({
          pageSize: limit,
          q: params.keyword,
          ...(params.category && { category: params.category }),
        });
        marketTotal = marketAgents.totalCount ?? marketAgents.items.length;

        agents.push(
          ...marketAgents.items.map((agent) => ({
            avatar: agent.avatar,
            backgroundColor: agent.backgroundColor,
            description: agent.description,
            id: agent.identifier,
            isMarket: true,
            title: agent.title,
          })),
        );
      }

      const uniqueAgents = agents.slice(0, limit);
      const totalCount = userTotal + marketTotal;

      // hasMore tracks workspace agents only: marketplace results are not offset-paged
      const shownUserCount = uniqueAgents.filter((a) => !a.isMarket).length;
      const hasMore = offset + shownUserCount < userTotal;

      const content = searchAgentsResultsPrompt({
        agents: uniqueAgents,
        hasMore,
        marketTotal,
        maxLimit: MAX_SEARCH_AGENT_LIMIT,
        offset,
        requestedLimit: params.limit,
        source,
        userTotal,
      });

      return {
        content,
        state: {
          agents: uniqueAgents,
          hasMore,
          keyword: params.keyword,
          offset,
          source,
          totalCount,
        } as SearchAgentState,
        success: true,
      };
    } catch (error) {
      return handleError(error, 'Failed to search agents');
    }
  }

  // ==================== Models ====================

  /**
   * Get available models and providers
   */
  async getAvailableModels(params: GetAvailableModelsParams): Promise<BuiltinToolResult> {
    try {
      const aiInfraState = getAiInfraStoreState();
      const enabledList = aiInfraState.enabledChatModelList || [];

      const filteredList = params.providerId
        ? enabledList.filter((p) => p.id === params.providerId)
        : enabledList;

      const providers: AvailableProvider[] = filteredList.map((provider) => ({
        id: provider.id,
        models: provider.children.map((model): AvailableModel => ({
          abilities: model.abilities
            ? {
                files: model.abilities.files,
                functionCall: model.abilities.functionCall,
                reasoning: model.abilities.reasoning,
                vision: model.abilities.vision,
              }
            : undefined,
          description: model.description,
          id: model.id,
          name: model.displayName || model.id,
        })),
        name: provider.name,
      }));

      const totalModels = providers.reduce((sum, p) => sum + p.models.length, 0);

      const xmlContent = modelsResultsPrompt(providers);
      const summary = `Found ${providers.length} provider(s) with ${totalModels} model(s) available.\n\n${xmlContent}`;

      return {
        content: summary,
        state: { providers } as GetAvailableModelsState,
        success: true,
      };
    } catch (error) {
      return handleError(error, 'Failed to get available models');
    }
  }

  // ==================== Prompt ====================

  /**
   * Update agent system prompt
   */
  async updatePrompt(agentId: string, params: UpdatePromptParams): Promise<BuiltinToolResult> {
    try {
      const previousPrompt = await this.enqueuePromptUpdate(agentId, async () => {
        await ensureAgentLoaded(this.agentService, agentId);
        const state = getAgentStoreState();
        const previousConfig = agentSelectors.getAgentConfigById(agentId)(state);

        if (params.streaming) {
          await this.performStreamingPromptUpdate(agentId, params.prompt);
        } else {
          await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
            editorData: null,
            systemRole: params.prompt,
          });
        }

        return previousConfig?.systemRole;
      });

      const content = params.prompt
        ? `Successfully updated system prompt (${params.prompt.length} characters)`
        : 'Successfully cleared system prompt';

      return {
        content,
        state: {
          newPrompt: params.prompt,
          previousPrompt,
          success: true,
        } as UpdatePromptState,
        success: true,
      };
    } catch (error) {
      return handleErrorWithState(error, 'Failed to update prompt', {
        newPrompt: params.prompt,
        success: false,
      } as UpdatePromptState);
    }
  }

  /**
   * Queue prompt mutations by agent so later invocations cannot finish first
   * and then be overwritten by an older, slower stream.
   */
  /**
   * Marketplace fallback for getAgentDetail. searchAgents surfaces agents
   * from the external market index (short-code identifiers), but those rows
   * do not exist in the local agents table — reading their detail through
   * the local path alone reports "not found" even though search found them.
   * Project the market detail into the same shape getAgentDetail returns so
   * callers can read (not edit) market agents.
   */
  private async getMarketAgentDetail(agentId: string): Promise<BuiltinToolResult | null> {
    if (!this.discoverService.getAssistantDetail) return null;

    let detail: DiscoverAssistantDetail | undefined;
    try {
      detail = await this.discoverService.getAssistantDetail({
        identifier: agentId,
        source: 'new',
      });
    } catch {
      // Market lookup is best-effort: fall through to the local "not found".
      return null;
    }

    const config = detail?.config as Record<string, any> | undefined;
    if (!detail || !config) return null;

    const plugins = config.plugins?.map((entry: any) => {
      const { identifier, mode } = parsePluginEntry(entry);
      return mode === 'pinned' ? identifier : `${identifier} (${mode})`;
    }) as string[] | undefined;

    // Marketplace configs can carry the model as an object
    // ({ model, provider, parameters }) — extract the nested model/provider so
    // the LLM-facing summary and GetAgentDetailRender never see "[object
    // Object]" (same normalization as src/services/agent.ts).
    let provider = config.provider as string | undefined;
    let model = config.model as string | undefined;
    if (model !== null && typeof model === 'object') {
      const { model: modelName, provider: modelProvider } = model as {
        model?: string;
        provider?: string;
      };
      model = modelName;
      provider = provider ?? modelProvider;
    }
    const systemRole = config.systemRole as string | undefined;

    const parts: string[] = [];
    if (detail.title) parts.push(`**${detail.title}**`);
    if (detail.description) parts.push(detail.description);
    if (model) parts.push(`Model: ${provider ? `${provider}/` : ''}${model}`);
    if (plugins?.length) parts.push(`Plugins: ${plugins.join(', ')}`);
    if (systemRole) parts.push(`System Prompt: ${systemRole}`);
    parts.push(
      'ℹ️ This is a marketplace agent (read-only). Install it into a workspace before editing.',
    );

    return {
      content: parts.join('\n'),
      state: {
        agentId,
        config: {
          model,
          openingMessage: config.openingMessage as string | undefined,
          openingQuestions: config.openingQuestions as string[] | undefined,
          plugins,
          provider,
          ...(config.agencyConfig && { runtime: describeHeterogeneousAgent(config.agencyConfig) }),
          systemRole,
        },
        isMarket: true,
        meta: {
          avatar: detail.avatar,
          backgroundColor: detail.backgroundColor,
          description: detail.description,
          tags: detail.tags,
          title: detail.title,
        },
        success: true,
      },
      success: true,
    };
  }

  private async enqueuePromptUpdate<T>(agentId: string, update: () => Promise<T>): Promise<T> {
    const previousUpdate = AgentManagerRuntime.promptUpdateQueues.get(agentId);
    const previousSettled = previousUpdate
      ? previousUpdate.then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    const queuedUpdate = previousSettled.then(update);

    AgentManagerRuntime.promptUpdateQueues.set(agentId, queuedUpdate);

    try {
      return await queuedUpdate;
    } finally {
      if (AgentManagerRuntime.promptUpdateQueues.get(agentId) === queuedUpdate) {
        AgentManagerRuntime.promptUpdateQueues.delete(agentId);
      }
    }
  }

  /**
   * Stream update prompt with typewriter effect
   */
  private async performStreamingPromptUpdate(agentId: string, prompt: string): Promise<void> {
    const generation = getAgentStoreState().startStreamingSystemRole(agentId);

    const chunkSize = 5;
    const delay = 10;

    for (let i = 0; i < prompt.length; i += chunkSize) {
      const chunk = prompt.slice(i, i + chunkSize);
      getAgentStoreState().appendStreamingSystemRole(agentId, generation, chunk);

      if (i + chunkSize < prompt.length) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    try {
      // Persistence is invocation-scoped and independent from ownership of the
      // global visual stream. Another agent may take over the animation without
      // turning this explicit update into a successful no-op.
      await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
        editorData: null,
        systemRole: prompt,
      });
    } finally {
      await getAgentStoreState().finishStreamingSystemRole(agentId, generation);
    }
  }

  // ==================== Plugin/Tools ====================

  /**
   * Search for tools in the marketplace
   */
  async searchMarketTools(params: SearchMarketToolsParams): Promise<BuiltinToolResult> {
    try {
      const toolState = getToolStoreState();

      const response = await this.discoverService.getMcpList({
        category: params.category,
        pageSize: params.pageSize || 10,
        q: params.query,
      });

      const tools: MarketToolItem[] = response.items.map((item) => {
        const installed = pluginSelectors.isPluginInstalled(item.identifier)(toolState);
        return {
          author: item.author,
          cloudEndPoint: (item as any).cloudEndPoint,
          description: item.description,
          haveCloudEndpoint: (item as any).haveCloudEndpoint,
          icon: item.icon,
          identifier: item.identifier,
          installed,
          name: item.name,
          tags: item.tags,
        };
      });

      const installedCount = tools.filter((t) => t.installed).length;
      const notInstalledCount = tools.length - installedCount;

      let summary = `Found ${response.totalCount} tool(s) in the marketplace.`;
      if (params.query) {
        summary = `Found ${response.totalCount} tool(s) matching "${params.query}".`;
      }
      if (installedCount > 0) {
        summary += ` ${installedCount} already installed, ${notInstalledCount} available to install.`;
      }

      const xmlContent = marketToolsResultsPrompt(tools);
      const content = `${summary}\n\n${xmlContent}`;

      return {
        content,
        state: {
          query: params.query,
          tools,
          totalCount: response.totalCount,
        } as SearchMarketToolsState,
        success: true,
      };
    } catch (error) {
      return handleError(error, 'Failed to search market tools');
    }
  }

  /**
   * Install a plugin
   */
  async installPlugin(agentId: string, params: InstallPluginParams): Promise<BuiltinToolResult> {
    return installPlugin(this.agentService, agentId, params);
  }
}
