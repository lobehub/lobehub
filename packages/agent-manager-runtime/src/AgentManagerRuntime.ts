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
import { KLAVIS_SERVER_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { marketToolsResultsPrompt, modelsResultsPrompt } from '@lobechat/prompts';
import type { BuiltinToolResult } from '@lobechat/types';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors/selectors';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { getToolStoreState } from '@/store/tool';
import {
  builtinToolSelectors,
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore/types';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

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
  InstallPluginState,
  MarketToolItem,
  SearchAgentParams,
  SearchAgentState,
  SearchMarketToolsParams,
  SearchMarketToolsState,
  UpdateAgentConfigParams,
  UpdateAgentConfigState,
  UpdatePromptParams,
  UpdatePromptState,
} from './types';

export class AgentManagerRuntime {
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
      const config = {
        avatar: params.avatar,
        backgroundColor: params.backgroundColor,
        description: params.description,
        model: params.model,
        openingMessage: params.openingMessage,
        openingQuestions: params.openingQuestions,
        plugins: params.plugins,
        provider: params.provider,
        systemRole: params.systemRole,
        tags: params.tags,
        title: params.title,
      };

      const result = await this.agentService.createAgent({ config });

      return {
        content: `Successfully created agent "${params.title}" with ID: ${result.agentId}`,
        state: {
          agentId: result.agentId,
          sessionId: result.sessionId,
          success: true,
        } as CreateAgentState,
        success: true,
      };
    } catch (error) {
      return this.handleError(error, 'Failed to create agent');
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
      const state = getAgentStoreState();
      const agentStore = getAgentStoreState();
      const resultState: UpdateAgentConfigState = { success: true };
      const contentParts: string[] = [];

      // Get current config for merging
      const previousConfig = agentSelectors.getAgentConfigById(agentId)(state);

      // Build the final config update, merging togglePlugin into config.plugins
      let finalConfig = params.config ? { ...params.config } : {};

      // Handle togglePlugin - merge into config.plugins
      if (params.togglePlugin) {
        const { pluginId, enabled } = params.togglePlugin;
        const currentPlugins = previousConfig.plugins || [];
        const isCurrentlyEnabled = currentPlugins.includes(pluginId);
        const shouldEnable = enabled !== undefined ? enabled : !isCurrentlyEnabled;

        let newPlugins: string[];
        if (shouldEnable && !isCurrentlyEnabled) {
          newPlugins = [...currentPlugins, pluginId];
        } else if (!shouldEnable && isCurrentlyEnabled) {
          newPlugins = currentPlugins.filter((id) => id !== pluginId);
        } else {
          newPlugins = currentPlugins;
        }

        finalConfig = { ...finalConfig, plugins: newPlugins };

        resultState.togglePlugin = {
          enabled: shouldEnable,
          pluginId,
        };
        contentParts.push(`plugin ${pluginId} ${shouldEnable ? 'enabled' : 'disabled'}`);
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
      if (params.meta && Object.keys(params.meta).length > 0) {
        const previousMeta = agentSelectors.getAgentMetaById(agentId)(state);
        const metaUpdatedFields = Object.keys(params.meta);
        const metaPreviousValues: Record<string, unknown> = {};

        for (const field of metaUpdatedFields) {
          metaPreviousValues[field] = (previousMeta as unknown as Record<string, unknown>)[field];
        }

        await agentStore.optimisticUpdateAgentMeta(agentId, params.meta);

        resultState.meta = {
          newValues: params.meta,
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
      return this.handleError(error, 'Failed to update agent');
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
      return this.handleError(error, 'Failed to delete agent');
    }
  }

  // ==================== Search ====================

  /**
   * Search agents (user's own and marketplace)
   */
  async searchAgents(params: SearchAgentParams): Promise<BuiltinToolResult> {
    try {
      const source = params.source || 'all';
      const limit = Math.min(params.limit || 10, 20);
      const agents: AgentSearchItem[] = [];

      // Search user's agents
      if (source === 'user' || source === 'all') {
        const userAgents = await this.agentService.queryAgents({
          keyword: params.keyword,
          limit,
        });

        agents.push(
          ...userAgents.map(
            (agent: {
              avatar?: string | null;
              backgroundColor?: string | null;
              description?: string | null;
              id: string;
              title?: string | null;
            }) => ({
              avatar: agent.avatar ?? undefined,
              backgroundColor: agent.backgroundColor ?? undefined,
              description: agent.description ?? undefined,
              id: agent.id,
              isMarket: false,
              title: agent.title ?? undefined,
            }),
          ),
        );
      }

      // Search marketplace agents
      if (source === 'market' || source === 'all') {
        const marketAgents = await this.discoverService.getAssistantList({
          pageSize: limit,
          q: params.keyword,
          ...(params.category && { category: params.category }),
        });

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

      const agentList = uniqueAgents
        .map((a) => `- ${a.title || 'Untitled'} (${a.id})${a.isMarket ? ' [Market]' : ''}`)
        .join('\n');

      return {
        content:
          uniqueAgents.length > 0
            ? `Found ${uniqueAgents.length} agents:\n${agentList}`
            : 'No agents found matching your search criteria.',
        state: {
          agents: uniqueAgents,
          keyword: params.keyword,
          source,
          totalCount: uniqueAgents.length,
        } as SearchAgentState,
        success: true,
      };
    } catch (error) {
      return this.handleError(error, 'Failed to search agents');
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
        models: provider.children.map(
          (model): AvailableModel => ({
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
          }),
        ),
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
      return this.handleError(error, 'Failed to get available models');
    }
  }

  // ==================== Prompt ====================

  /**
   * Update agent system prompt
   */
  async updatePrompt(agentId: string, params: UpdatePromptParams): Promise<BuiltinToolResult> {
    try {
      const state = getAgentStoreState();
      const previousConfig = agentSelectors.getAgentConfigById(agentId)(state);
      const previousPrompt = previousConfig.systemRole;

      if (params.streaming) {
        await this.streamUpdatePrompt(agentId, params.prompt);
      } else {
        await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
          systemRole: params.prompt,
        });
      }

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
      return this.handleErrorWithState(error, 'Failed to update prompt', {
        newPrompt: params.prompt,
        success: false,
      } as UpdatePromptState);
    }
  }

  /**
   * Stream update prompt with typewriter effect
   */
  private async streamUpdatePrompt(agentId: string, prompt: string): Promise<void> {
    getAgentStoreState().startStreamingSystemRole();

    const chunkSize = 5;
    const delay = 10;

    for (let i = 0; i < prompt.length; i += chunkSize) {
      const chunk = prompt.slice(i, i + chunkSize);
      getAgentStoreState().appendStreamingSystemRole(chunk);

      if (i + chunkSize < prompt.length) {
        // eslint-disable-next-line no-promise-executor-return
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    await getAgentStoreState().finishStreamingSystemRole(agentId);
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
      return this.handleError(error, 'Failed to search market tools');
    }
  }

  /**
   * Install a plugin
   */
  async installPlugin(agentId: string, params: InstallPluginParams): Promise<BuiltinToolResult> {
    const { identifier, source } = params;

    try {
      const toolState = getToolStoreState();

      if (source === 'official') {
        // Check if it's a Klavis tool
        const isKlavisEnabled =
          typeof window !== 'undefined' &&
          window.global_serverConfigStore?.getState()?.serverConfig?.enableKlavis;

        if (isKlavisEnabled) {
          const klavisServer = klavisStoreSelectors
            .getServers(toolState)
            .find((s) => s.identifier === identifier);
          const klavisTypeInfo = KLAVIS_SERVER_TYPES.find((t) => t.identifier === identifier);

          if (klavisTypeInfo) {
            return this.handleKlavisInstall(agentId, identifier, klavisTypeInfo, klavisServer);
          }
        }

        // Check if it's a LobehubSkill provider
        const isLobehubSkillEnabled =
          typeof window !== 'undefined' &&
          window.global_serverConfigStore?.getState()?.serverConfig?.enableLobehubSkill;

        if (isLobehubSkillEnabled) {
          const lobehubSkillServer = lobehubSkillStoreSelectors
            .getServers(toolState)
            .find((s) => s.identifier === identifier);
          const lobehubSkillProviderInfo = LOBEHUB_SKILL_PROVIDERS.find((p) => p.id === identifier);

          if (lobehubSkillProviderInfo) {
            return this.handleLobehubSkillInstall(
              agentId,
              identifier,
              lobehubSkillProviderInfo,
              lobehubSkillServer,
            );
          }
        }

        // Check if it's a builtin tool
        const builtinTools = builtinToolSelectors.metaList(toolState);
        const builtinTool = builtinTools.find((t) => t.identifier === identifier);

        if (builtinTool) {
          const agentState = getAgentStoreState();
          const currentPlugins =
            agentSelectors.getAgentConfigById(agentId)(agentState).plugins || [];

          if (!currentPlugins.includes(identifier)) {
            await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
              plugins: [...currentPlugins, identifier],
            });
          }

          return {
            content: `Successfully enabled builtin tool: ${builtinTool.meta?.title || identifier}`,
            state: {
              installed: true,
              pluginId: identifier,
              pluginName: builtinTool.meta?.title || identifier,
              success: true,
            } as InstallPluginState,
            success: true,
          };
        }

        return {
          content: `Official tool "${identifier}" not found.`,
          error: { message: 'Tool not found', type: 'NotFound' },
          state: {
            installed: false,
            pluginId: identifier,
            success: false,
          } as InstallPluginState,
          success: false,
        };
      }

      // Source is 'market' - MCP marketplace plugin
      return this.handleMarketPluginInstall(agentId, identifier);
    } catch (error) {
      const err = error as Error;
      return this.handleErrorWithState(error, 'Failed to install plugin', {
        error: err.message,
        installed: false,
        pluginId: identifier,
        success: false,
      } as InstallPluginState);
    }
  }

  // ==================== Private Helper Methods ====================

  private async handleKlavisInstall(
    agentId: string,
    identifier: string,
    klavisTypeInfo: (typeof KLAVIS_SERVER_TYPES)[0],
    klavisServer: any,
  ): Promise<BuiltinToolResult> {
    if (klavisServer) {
      if (klavisServer.status === KlavisServerStatus.CONNECTED) {
        await this.enablePluginForAgent(agentId, identifier);
        return {
          content: `Successfully enabled Klavis tool: ${klavisTypeInfo.label}`,
          state: {
            installed: true,
            isKlavis: true,
            pluginId: identifier,
            pluginName: klavisTypeInfo.label,
            serverStatus: 'connected',
            success: true,
          } as InstallPluginState,
          success: true,
        };
      } else if (klavisServer.status === KlavisServerStatus.PENDING_AUTH) {
        if (klavisServer.oauthUrl) {
          const authResult = await this.openOAuthWindowAndWait(klavisServer.oauthUrl, identifier);
          if (authResult.success) {
            await this.enablePluginForAgent(agentId, identifier);
            return {
              content: `Successfully connected and enabled Klavis tool: ${klavisTypeInfo.label}`,
              state: {
                installed: true,
                isKlavis: true,
                pluginId: identifier,
                pluginName: klavisTypeInfo.label,
                serverStatus: 'connected',
                success: true,
              } as InstallPluginState,
              success: true,
            };
          }
        }
        return {
          content: `OAuth authorization was cancelled or failed for Klavis tool: ${klavisTypeInfo.label}. Please try again.`,
          state: {
            installed: false,
            isKlavis: true,
            pluginId: identifier,
            pluginName: klavisTypeInfo.label,
            serverStatus: 'pending_auth',
            success: false,
          } as InstallPluginState,
          success: false,
        };
      }
    }

    // Server doesn't exist, create it
    const userId = userProfileSelectors.userId(getUserStoreState());
    if (!userId) {
      return {
        content: `Cannot connect Klavis tool: User not logged in.`,
        error: { message: 'User not logged in', type: 'AuthRequired' },
        state: {
          installed: false,
          pluginId: identifier,
          success: false,
        } as InstallPluginState,
        success: false,
      };
    }

    const newServer = await getToolStoreState().createKlavisServer({
      identifier,
      serverName: klavisTypeInfo.serverName,
      userId,
    });

    if (newServer) {
      await this.enablePluginForAgent(agentId, identifier);

      if (newServer.isAuthenticated) {
        await getToolStoreState().refreshKlavisServerTools(newServer.identifier);
        return {
          content: `Successfully connected and enabled Klavis tool: ${klavisTypeInfo.label}`,
          state: {
            installed: true,
            isKlavis: true,
            pluginId: identifier,
            pluginName: klavisTypeInfo.label,
            serverStatus: 'connected',
            success: true,
          } as InstallPluginState,
          success: true,
        };
      } else if (newServer.oauthUrl) {
        const authResult = await this.openOAuthWindowAndWait(
          newServer.oauthUrl,
          newServer.identifier,
        );
        if (authResult.success) {
          return {
            content: `Successfully connected and enabled Klavis tool: ${klavisTypeInfo.label}`,
            state: {
              installed: true,
              isKlavis: true,
              pluginId: identifier,
              pluginName: klavisTypeInfo.label,
              serverStatus: 'connected',
              success: true,
            } as InstallPluginState,
            success: true,
          };
        }
      }
    }

    return {
      content: `Failed to connect Klavis tool: ${klavisTypeInfo.label}`,
      error: { message: 'Failed to create Klavis server', type: 'KlavisError' },
      state: {
        installed: false,
        pluginId: identifier,
        success: false,
      } as InstallPluginState,
      success: false,
    };
  }

  private async handleLobehubSkillInstall(
    agentId: string,
    identifier: string,
    providerInfo: (typeof LOBEHUB_SKILL_PROVIDERS)[0],
    server: any,
  ): Promise<BuiltinToolResult> {
    if (server?.status === LobehubSkillStatus.CONNECTED) {
      await this.enablePluginForAgent(agentId, identifier);
      return {
        content: `Successfully enabled LobehubSkill provider: ${providerInfo.label}`,
        state: {
          installed: true,
          isLobehubSkill: true,
          pluginId: identifier,
          pluginName: providerInfo.label,
          serverStatus: 'connected',
          success: true,
        } as InstallPluginState,
        success: true,
      };
    }

    // Need OAuth authorization
    const redirectUri =
      typeof window !== 'undefined'
        ? `${window.location.origin}/oauth/callback/success?provider=${encodeURIComponent(identifier)}`
        : undefined;
    const authInfo = await getToolStoreState().getLobehubSkillAuthorizeUrl(identifier, {
      redirectUri,
    });

    if (!authInfo.authorizeUrl) {
      return {
        content: `LobehubSkill provider "${providerInfo.label}" requires OAuth authorization but no authorization URL is available.`,
        state: {
          installed: false,
          isLobehubSkill: true,
          pluginId: identifier,
          pluginName: providerInfo.label,
          serverStatus: 'not_connected',
          success: false,
        } as InstallPluginState,
        success: false,
      };
    }

    const authResult = await this.openLobehubSkillOAuthWindowAndWait(
      authInfo.authorizeUrl,
      identifier,
    );

    if (authResult.success) {
      await this.enablePluginForAgent(agentId, identifier);
      return {
        content: `Successfully connected and enabled LobehubSkill provider: ${providerInfo.label}`,
        state: {
          installed: true,
          isLobehubSkill: true,
          pluginId: identifier,
          pluginName: providerInfo.label,
          serverStatus: 'connected',
          success: true,
        } as InstallPluginState,
        success: true,
      };
    }

    return {
      content: `OAuth authorization was cancelled or failed for LobehubSkill provider: ${providerInfo.label}. Please try again.`,
      state: {
        installed: false,
        isLobehubSkill: true,
        pluginId: identifier,
        pluginName: providerInfo.label,
        serverStatus: 'not_connected',
        success: false,
      } as InstallPluginState,
      success: false,
    };
  }

  private async handleMarketPluginInstall(
    agentId: string,
    identifier: string,
  ): Promise<BuiltinToolResult> {
    const toolState = getToolStoreState();
    const isInstalled = pluginSelectors.isPluginInstalled(identifier)(toolState);

    if (isInstalled) {
      await this.enablePluginForAgent(agentId, identifier);
      const installedPlugin = pluginSelectors.getInstalledPluginById(identifier)(toolState);
      return {
        content: `Plugin "${installedPlugin?.manifest?.meta?.title || identifier}" is already installed. Enabled for current agent.`,
        state: {
          installed: true,
          pluginId: identifier,
          pluginName: installedPlugin?.manifest?.meta?.title || identifier,
          success: true,
        } as InstallPluginState,
        success: true,
      };
    }

    const installSuccess = await getToolStoreState().installMCPPlugin(identifier);

    if (installSuccess) {
      await this.enablePluginForAgent(agentId, identifier);
      await getToolStoreState().refreshPlugins();
      const freshToolState = getToolStoreState();
      const installedPlugin = pluginSelectors.getInstalledPluginById(identifier)(freshToolState);

      return {
        content: `Successfully installed and enabled MCP plugin "${installedPlugin?.manifest?.meta?.title || identifier}".`,
        state: {
          installed: true,
          pluginId: identifier,
          pluginName: installedPlugin?.manifest?.meta?.title || identifier,
          success: true,
        } as InstallPluginState,
        success: true,
      };
    }

    return {
      content: `Failed to install MCP plugin "${identifier}". Installation was cancelled or configuration is needed.`,
      state: {
        installed: false,
        pluginId: identifier,
        success: false,
      } as InstallPluginState,
      success: false,
    };
  }

  private async enablePluginForAgent(agentId: string, pluginId: string): Promise<void> {
    const agentState = getAgentStoreState();
    const currentPlugins = agentSelectors.getAgentConfigById(agentId)(agentState).plugins || [];

    if (!currentPlugins.includes(pluginId)) {
      await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
        plugins: [...currentPlugins, pluginId],
      });
    }
  }

  private openOAuthWindowAndWait(
    oauthUrl: string,
    identifier: string,
  ): Promise<{ cancelled: boolean; success: boolean }> {
    const checkAuthStatus = async (): Promise<boolean> => {
      try {
        await getToolStoreState().refreshKlavisServerTools(identifier);
        const freshToolStore = getToolStoreState();
        const server = klavisStoreSelectors
          .getServers(freshToolStore)
          .find((s) => s.identifier === identifier);
        return server?.status === KlavisServerStatus.CONNECTED;
      } catch {
        return false;
      }
    };

    return new Promise((resolve) => {
      const WINDOW_CHECK_INTERVAL_MS = 500;
      const POLL_INTERVAL_MS = 1000;
      const POLL_TIMEOUT_MS = 300_000;

      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let pollTimeout: ReturnType<typeof setTimeout> | null = null;
      let windowCheckInterval: ReturnType<typeof setInterval> | null = null;
      let resolved = false;

      const cleanup = () => {
        if (windowCheckInterval) clearInterval(windowCheckInterval);
        if (pollInterval) clearInterval(pollInterval);
        if (pollTimeout) clearTimeout(pollTimeout);
      };

      const resolveOnce = (result: { cancelled: boolean; success: boolean }) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      };

      const startFallbackPolling = () => {
        if (pollInterval) return;
        pollInterval = setInterval(async () => {
          const isConnected = await checkAuthStatus();
          if (isConnected) resolveOnce({ cancelled: false, success: true });
        }, POLL_INTERVAL_MS);
        pollTimeout = setTimeout(
          () => resolveOnce({ cancelled: true, success: false }),
          POLL_TIMEOUT_MS,
        );
      };

      const oauthWindow = window.open(oauthUrl, '_blank', 'width=600,height=700');

      if (oauthWindow) {
        windowCheckInterval = setInterval(async () => {
          try {
            if (oauthWindow.closed) {
              if (windowCheckInterval) clearInterval(windowCheckInterval);
              const isConnected = await checkAuthStatus();
              resolveOnce({ cancelled: !isConnected, success: isConnected });
            }
          } catch {
            if (windowCheckInterval) clearInterval(windowCheckInterval);
            startFallbackPolling();
          }
        }, WINDOW_CHECK_INTERVAL_MS);
      } else {
        startFallbackPolling();
      }
    });
  }

  private openLobehubSkillOAuthWindowAndWait(
    oauthUrl: string,
    provider: string,
  ): Promise<{ cancelled: boolean; success: boolean }> {
    const checkAuthStatus = async (): Promise<boolean> => {
      try {
        const server = await getToolStoreState().checkLobehubSkillStatus(provider);
        return server?.status === LobehubSkillStatus.CONNECTED;
      } catch {
        return false;
      }
    };

    return new Promise((resolve) => {
      const WINDOW_CHECK_INTERVAL_MS = 500;
      const POLL_INTERVAL_MS = 1000;
      const POLL_TIMEOUT_MS = 300_000;

      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let pollTimeout: ReturnType<typeof setTimeout> | null = null;
      let windowCheckInterval: ReturnType<typeof setInterval> | null = null;
      let messageHandler: ((event: MessageEvent) => void) | null = null;
      let resolved = false;

      const cleanup = () => {
        if (windowCheckInterval) clearInterval(windowCheckInterval);
        if (pollInterval) clearInterval(pollInterval);
        if (pollTimeout) clearTimeout(pollTimeout);
        if (messageHandler) window.removeEventListener('message', messageHandler);
      };

      const resolveOnce = (result: { cancelled: boolean; success: boolean }) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      };

      messageHandler = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (
          event.data?.type === 'LOBEHUB_SKILL_AUTH_SUCCESS' &&
          event.data?.provider === provider
        ) {
          const server = await getToolStoreState().checkLobehubSkillStatus(provider);
          const isConnected = server?.status === LobehubSkillStatus.CONNECTED;
          resolveOnce({ cancelled: false, success: isConnected });
        }
      };

      window.addEventListener('message', messageHandler);

      const startFallbackPolling = () => {
        if (pollInterval) return;
        pollInterval = setInterval(async () => {
          const isConnected = await checkAuthStatus();
          if (isConnected) resolveOnce({ cancelled: false, success: true });
        }, POLL_INTERVAL_MS);
        pollTimeout = setTimeout(
          () => resolveOnce({ cancelled: true, success: false }),
          POLL_TIMEOUT_MS,
        );
      };

      const oauthWindow = window.open(oauthUrl, '_blank', 'width=600,height=700');

      if (oauthWindow) {
        windowCheckInterval = setInterval(async () => {
          try {
            if (oauthWindow.closed) {
              if (windowCheckInterval) clearInterval(windowCheckInterval);
              const isConnected = await checkAuthStatus();
              resolveOnce({ cancelled: !isConnected, success: isConnected });
            }
          } catch {
            if (windowCheckInterval) clearInterval(windowCheckInterval);
            startFallbackPolling();
          }
        }, WINDOW_CHECK_INTERVAL_MS);
      } else {
        startFallbackPolling();
      }
    });
  }

  // ==================== Error Handling ====================

  private handleError(error: unknown, context: string): BuiltinToolResult {
    const err = error as Error;
    return {
      content: `${context}: ${err.message}`,
      error: {
        body: error,
        message: err.message,
        type: 'RuntimeError',
      },
      success: false,
    };
  }

  private handleErrorWithState<T extends object>(
    error: unknown,
    context: string,
    state: T,
  ): BuiltinToolResult {
    const err = error as Error;
    return {
      content: `${context}: ${err.message}`,
      error: {
        body: error,
        message: err.message,
        type: 'RuntimeError',
      },
      state,
      success: false,
    };
  }
}
