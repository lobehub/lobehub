import { KLAVIS_SERVER_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { marketToolsResultsPrompt, modelsResultsPrompt } from '@lobechat/prompts';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { discoverService } from '@/services/discover';
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
  AvailableModel,
  AvailableProvider,
  GetAvailableModelsParams,
  GetAvailableModelsState,
  InstallPluginParams,
  InstallPluginState,
  MarketToolItem,
  SearchMarketToolsParams,
  SearchMarketToolsState,
  UpdateAgentConfigParams,
  UpdateConfigState,
  UpdatePromptParams,
  UpdatePromptState,
} from '../types';

/**
 * Agent Builder Execution Runtime
 * Handles the execution logic for all Agent Builder APIs
 *
 * Note: getAgentConfig, getAgentMeta, getPrompt, getAvailableTools, searchOfficialTools are removed
 * because the current agent context is now automatically injected into the conversation
 */
export class AgentBuilderExecutionRuntime {
  // ==================== Read Operations ====================

  /**
   * Get available models and providers
   */
  async getAvailableModels(args: GetAvailableModelsParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const aiInfraState = getAiInfraStoreState();
      const enabledList = aiInfraState.enabledChatModelList || [];

      // Filter by providerId if specified
      const filteredList = args.providerId
        ? enabledList.filter((p) => p.id === args.providerId)
        : enabledList;

      // Transform to our response format
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

      // Convert to XML format to provide detailed model list to agent
      const xmlContent = modelsResultsPrompt(providers);
      const summary = `Found ${providers.length} provider(s) with ${totalModels} model(s) available.\n\n${xmlContent}`;

      return {
        content: summary,
        state: { providers } as GetAvailableModelsState,
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to get available models: ${err.message}`,
        error,
        success: false,
      };
    }
  }

  /**
   * Search for tools in the marketplace
   */
  async searchMarketTools(args: SearchMarketToolsParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const toolState = getToolStoreState();

      // Fetch from market
      const response = await discoverService.getMcpList({
        category: args.category,
        pageSize: args.pageSize || 10,
        q: args.query,
      });

      // Transform to our format and check installation status
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
      if (args.query) {
        summary = `Found ${response.totalCount} tool(s) matching "${args.query}".`;
      }
      if (installedCount > 0) {
        summary += ` ${installedCount} already installed, ${notInstalledCount} available to install.`;
      }

      // Convert to XML format to provide detailed tool list to agent
      const xmlContent = marketToolsResultsPrompt(tools);
      const content = `${summary}\n\n${xmlContent}`;

      return {
        content,
        state: {
          query: args.query,
          tools,
          totalCount: response.totalCount,
        } as SearchMarketToolsState,
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to search market tools: ${err.message}`,
        error,
        success: false,
      };
    }
  }

  // Note: searchOfficialTools is removed because official tools are now
  // automatically injected into the conversation context via AgentBuilderContextInjector

  // ==================== Write Operations ====================

  /**
   * Update agent configuration and/or metadata
   * Now also handles plugin toggle operations in a single update
   */
  async updateAgentConfig(
    agentId: string,
    args: UpdateAgentConfigParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const state = getAgentStoreState();
      const agentStore = getAgentStoreState();
      const resultState: UpdateConfigState = { success: true };
      const contentParts: string[] = [];

      // Get current config for merging
      const previousConfig = agentSelectors.getAgentConfigById(agentId)(state);

      // Build the final config update, merging togglePlugin into config.plugins
      let finalConfig = args.config ? { ...args.config } : {};

      // Handle togglePlugin - merge into config.plugins
      if (args.togglePlugin) {
        const { pluginId, enabled } = args.togglePlugin;
        const currentPlugins = previousConfig.plugins || [];
        const isCurrentlyEnabled = currentPlugins.includes(pluginId);
        const shouldEnable = enabled !== undefined ? enabled : !isCurrentlyEnabled;

        let newPlugins: string[];
        if (shouldEnable && !isCurrentlyEnabled) {
          // Enable: add plugin
          newPlugins = [...currentPlugins, pluginId];
        } else if (!shouldEnable && isCurrentlyEnabled) {
          // Disable: remove plugin
          newPlugins = currentPlugins.filter((id) => id !== pluginId);
        } else {
          // No change needed
          newPlugins = currentPlugins;
        }

        // Merge plugins into finalConfig
        finalConfig = { ...finalConfig, plugins: newPlugins };

        resultState.togglePlugin = {
          enabled: shouldEnable,
          pluginId,
        };
        contentParts.push(`plugin ${pluginId} ${shouldEnable ? 'enabled' : 'disabled'}`);
      }

      // Handle config update (including merged plugins from togglePlugin)
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

        // Only add config to resultState if there are non-plugin updates
        const nonPluginFields = configUpdatedFields.filter((f) => f !== 'plugins');
        if (nonPluginFields.length > 0 || !args.togglePlugin) {
          resultState.config = {
            newValues: configNewValues,
            previousValues: configPreviousValues,
            updatedFields: configUpdatedFields,
          };
          if (!args.togglePlugin) {
            contentParts.push(`config fields: ${configUpdatedFields.join(', ')}`);
          } else if (nonPluginFields.length > 0) {
            contentParts.push(`config fields: ${nonPluginFields.join(', ')}`);
          }
        }
      }

      // Handle meta update
      if (args.meta && Object.keys(args.meta).length > 0) {
        const previousMeta = agentSelectors.getAgentMetaById(agentId)(state);
        const metaUpdatedFields = Object.keys(args.meta);
        const metaPreviousValues: Record<string, unknown> = {};

        for (const field of metaUpdatedFields) {
          metaPreviousValues[field] = (previousMeta as unknown as Record<string, unknown>)[field];
        }

        await agentStore.optimisticUpdateAgentMeta(agentId, args.meta);

        resultState.meta = {
          newValues: args.meta,
          previousValues: metaPreviousValues as Record<string, unknown>,
          updatedFields: metaUpdatedFields,
        };
        contentParts.push(`meta fields: ${metaUpdatedFields.join(', ')}`);
      }

      if (contentParts.length === 0) {
        return {
          content: 'No fields to update.',
          state: { success: true } as UpdateConfigState,
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
      const err = error as Error;
      return {
        content: `Failed to update agent: ${err.message}`,
        error,
        state: { success: false } as UpdateConfigState,
        success: false,
      };
    }
  }

  /**
   * Update agent system prompt
   */
  async updatePrompt(
    agentId: string,
    args: UpdatePromptParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const state = getAgentStoreState();
      const previousConfig = agentSelectors.getAgentConfigById(agentId)(state);
      const previousPrompt = previousConfig.systemRole;

      if (args.streaming) {
        // Use streaming mode for typewriter effect
        await this.streamUpdatePrompt(agentId, args.prompt);
      } else {
        // Update the system prompt directly
        await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
          systemRole: args.prompt,
        });
      }

      const content = args.prompt
        ? `Successfully updated system prompt (${args.prompt.length} characters)`
        : 'Successfully cleared system prompt';

      return {
        content,
        state: {
          newPrompt: args.prompt,
          previousPrompt,
          success: true,
        } as UpdatePromptState,
        success: true,
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to update prompt: ${err.message}`,
        error,
        state: {
          newPrompt: args.prompt,
          success: false,
        } as UpdatePromptState,
        success: false,
      };
    }
  }

  /**
   * Open OAuth window and wait for LobehubSkill authentication completion
   * Returns a Promise that resolves when OAuth completes or fails
   */
  private openLobehubSkillOAuthWindowAndWait(
    oauthUrl: string,
    provider: string,
  ): Promise<{ cancelled: boolean; success: boolean }> {
    return new Promise((resolve) => {
      // Configuration
      const WINDOW_CHECK_INTERVAL_MS = 500;
      const POLL_INTERVAL_MS = 1000;
      const POLL_TIMEOUT_MS = 300_000; // 5 minutes timeout

      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let pollTimeout: ReturnType<typeof setTimeout> | null = null;
      let windowCheckInterval: ReturnType<typeof setInterval> | null = null;
      let messageHandler: ((event: MessageEvent) => void) | null = null;
      let resolved = false;

      const cleanup = () => {
        if (windowCheckInterval) {
          clearInterval(windowCheckInterval);
          windowCheckInterval = null;
        }
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        if (pollTimeout) {
          clearTimeout(pollTimeout);
          pollTimeout = null;
        }
        if (messageHandler) {
          window.removeEventListener('message', messageHandler);
          messageHandler = null;
        }
      };

      const resolveOnce = (result: { cancelled: boolean; success: boolean }) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      };

      // Listen for OAuth success message from popup window
      messageHandler = async (event: MessageEvent) => {
        // Verify origin for security
        if (event.origin !== window.location.origin) return;

        if (
          event.data?.type === 'LOBEHUB_SKILL_AUTH_SUCCESS' &&
          event.data?.provider === provider
        ) {
          console.log('[LobehubSkill] OAuth success message received for provider:', provider);

          // Refresh status to get the connected state
          const server = await getToolStoreState().checkLobehubSkillStatus(provider);
          const isConnected = server?.status === LobehubSkillStatus.CONNECTED;

          resolveOnce({ cancelled: false, success: isConnected });
        }
      };

      window.addEventListener('message', messageHandler);

      const checkAuthStatus = async (): Promise<boolean> => {
        try {
          // Check LobehubSkill status
          const server = await getToolStoreState().checkLobehubSkillStatus(provider);
          return server?.status === LobehubSkillStatus.CONNECTED;
        } catch (error) {
          console.error('[LobehubSkill] Failed to check auth status:', error);
          return false;
        }
      };

      const startFallbackPolling = () => {
        if (pollInterval) return;

        pollInterval = setInterval(async () => {
          const isConnected = await checkAuthStatus();
          if (isConnected) {
            resolveOnce({ cancelled: false, success: true });
          }
        }, POLL_INTERVAL_MS);

        // Timeout after 5 minutes
        pollTimeout = setTimeout(() => {
          resolveOnce({ cancelled: true, success: false });
        }, POLL_TIMEOUT_MS);
      };

      // Open OAuth window
      const oauthWindow = window.open(oauthUrl, '_blank', 'width=600,height=700');

      if (oauthWindow) {
        // Monitor window close
        windowCheckInterval = setInterval(async () => {
          try {
            if (oauthWindow.closed) {
              if (windowCheckInterval) {
                clearInterval(windowCheckInterval);
                windowCheckInterval = null;
              }

              // Window closed, check auth status
              const isConnected = await checkAuthStatus();
              resolveOnce({ cancelled: !isConnected, success: isConnected });
            }
          } catch {
            // COOP blocked window.closed access, fall back to polling
            console.log(
              '[LobehubSkill] COOP blocked window.closed access, falling back to polling',
            );
            if (windowCheckInterval) {
              clearInterval(windowCheckInterval);
              windowCheckInterval = null;
            }
            startFallbackPolling();
          }
        }, WINDOW_CHECK_INTERVAL_MS);
      } else {
        // Window was blocked, use polling
        console.log('[LobehubSkill] OAuth window was blocked, falling back to polling');
        startFallbackPolling();
      }
    });
  }

  /**
   * Open OAuth window and wait for Klavis authentication completion
   * Returns a Promise that resolves when OAuth completes or fails
   */
  private openOAuthWindowAndWait(
    oauthUrl: string,
    identifier: string,
  ): Promise<{ cancelled: boolean; success: boolean }> {
    return new Promise((resolve) => {
      // Configuration
      const WINDOW_CHECK_INTERVAL_MS = 500;
      const POLL_INTERVAL_MS = 1000;
      const POLL_TIMEOUT_MS = 300_000; // 5 minutes timeout

      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let pollTimeout: ReturnType<typeof setTimeout> | null = null;
      let windowCheckInterval: ReturnType<typeof setInterval> | null = null;
      let resolved = false;

      const cleanup = () => {
        if (windowCheckInterval) {
          clearInterval(windowCheckInterval);
          windowCheckInterval = null;
        }
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        if (pollTimeout) {
          clearTimeout(pollTimeout);
          pollTimeout = null;
        }
      };

      const resolveOnce = (result: { cancelled: boolean; success: boolean }) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      };

      const checkAuthStatus = async (): Promise<boolean> => {
        try {
          // Refresh server status first
          await getToolStoreState().refreshKlavisServerTools(identifier);

          // Get fresh state after refresh (important: must get new state after refresh)
          const freshToolStore = getToolStoreState();
          const server = klavisStoreSelectors
            .getServers(freshToolStore)
            .find((s) => s.identifier === identifier);

          return server?.status === KlavisServerStatus.CONNECTED;
        } catch (error) {
          console.error('[Klavis] Failed to check auth status:', error);
          return false;
        }
      };

      const startFallbackPolling = () => {
        if (pollInterval) return;

        pollInterval = setInterval(async () => {
          const isConnected = await checkAuthStatus();
          if (isConnected) {
            resolveOnce({ cancelled: false, success: true });
          }
        }, POLL_INTERVAL_MS);

        // Timeout after 5 minutes
        pollTimeout = setTimeout(() => {
          resolveOnce({ cancelled: true, success: false });
        }, POLL_TIMEOUT_MS);
      };

      // Open OAuth window
      const oauthWindow = window.open(oauthUrl, '_blank', 'width=600,height=700');

      if (oauthWindow) {
        // Monitor window close
        windowCheckInterval = setInterval(async () => {
          try {
            if (oauthWindow.closed) {
              if (windowCheckInterval) {
                clearInterval(windowCheckInterval);
                windowCheckInterval = null;
              }

              // Window closed, check auth status
              const isConnected = await checkAuthStatus();
              resolveOnce({ cancelled: !isConnected, success: isConnected });
            }
          } catch {
            // COOP blocked window.closed access, fall back to polling
            console.log('[Klavis] COOP blocked window.closed access, falling back to polling');
            if (windowCheckInterval) {
              clearInterval(windowCheckInterval);
              windowCheckInterval = null;
            }
            startFallbackPolling();
          }
        }, WINDOW_CHECK_INTERVAL_MS);
      } else {
        // Window was blocked, use polling
        console.log('[Klavis] OAuth window was blocked, falling back to polling');
        startFallbackPolling();
      }
    });
  }

  /**
   * Stream update prompt with typewriter effect
   */
  private async streamUpdatePrompt(agentId: string, prompt: string): Promise<void> {
    // Start streaming
    getAgentStoreState().startStreamingSystemRole();

    // Simulate streaming by chunking the content
    const chunkSize = 5; // Characters per chunk
    const delay = 10; // Milliseconds between chunks

    for (let i = 0; i < prompt.length; i += chunkSize) {
      const chunk = prompt.slice(i, i + chunkSize);
      getAgentStoreState().appendStreamingSystemRole(chunk);

      // Small delay for typewriter effect
      if (i + chunkSize < prompt.length) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Finish streaming - EditorCanvas will handle save when streaming ends
    await getAgentStoreState().finishStreamingSystemRole(agentId);
  }

  // ==================== Plugin Installation ====================

  /**
   * Install a plugin (MCP marketplace or Klavis/Builtin)
   * This method prepares the installation state but requires user approval
   * to actually perform the installation.
   */
  async installPlugin(
    agentId: string,
    args: InstallPluginParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    const { identifier, source } = args;

    try {
      const toolState = getToolStoreState();

      if (source === 'official') {
        // Check if it's a Klavis tool
        const isKlavisEnabled =
          typeof window !== 'undefined' &&
          window.global_serverConfigStore?.getState()?.serverConfig?.enableKlavis;

        if (isKlavisEnabled) {
          // Check if this is a Klavis tool
          const klavisServer = klavisStoreSelectors
            .getServers(toolState)
            .find((s) => s.identifier === identifier);

          // Find Klavis tool info from KLAVIS_SERVER_TYPES
          const klavisTypeInfo = KLAVIS_SERVER_TYPES.find((t) => t.identifier === identifier);

          if (klavisTypeInfo) {
            // This is a Klavis tool
            if (klavisServer) {
              // Server exists
              if (klavisServer.status === KlavisServerStatus.CONNECTED) {
                // Already connected, just enable the plugin
                const agentState = getAgentStoreState();
                const currentPlugins =
                  agentSelectors.getAgentConfigById(agentId)(agentState).plugins || [];

                if (!currentPlugins.includes(identifier)) {
                  await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
                    plugins: [...currentPlugins, identifier],
                  });
                }

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
                // Needs OAuth authorization - open OAuth window and wait for completion
                if (klavisServer.oauthUrl) {
                  const authResult = await this.openOAuthWindowAndWait(
                    klavisServer.oauthUrl,
                    identifier,
                  );

                  if (authResult.success) {
                    // OAuth successful, enable the plugin
                    const agentState = getAgentStoreState();
                    const currentPlugins =
                      agentSelectors.getAgentConfigById(agentId)(agentState).plugins || [];

                    if (!currentPlugins.includes(identifier)) {
                      await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
                        plugins: [...currentPlugins, identifier],
                      });
                    }

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
                  } else {
                    // OAuth cancelled or failed
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

                // No OAuth URL available
                return {
                  content: `Klavis tool "${klavisTypeInfo.label}" requires OAuth authorization but no OAuth URL is available.`,
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
              } else {
                // Server exists but in ERROR state or other unknown state
                return {
                  content: `Klavis tool "${klavisTypeInfo.label}" is in an error state. Please try reconnecting.`,
                  error: 'Klavis server in error state',
                  state: {
                    installed: false,
                    isKlavis: true,
                    pluginId: identifier,
                    pluginName: klavisTypeInfo.label,
                    serverStatus: 'error',
                    success: false,
                  } as InstallPluginState,
                  success: false,
                };
              }
            } else {
              // Server doesn't exist yet, create it using createKlavisServer
              const userId = userProfileSelectors.userId(getUserStoreState());
              if (!userId) {
                return {
                  content: `Cannot connect Klavis tool: User not logged in.`,
                  error: 'User not logged in',
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
                // Enable the plugin for the agent
                const agentState = getAgentStoreState();
                const currentPlugins =
                  agentSelectors.getAgentConfigById(agentId)(agentState).plugins || [];

                if (!currentPlugins.includes(identifier)) {
                  await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
                    plugins: [...currentPlugins, identifier],
                  });
                }

                if (newServer.isAuthenticated) {
                  // Already authenticated, refresh tools
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
                  // Needs OAuth, open window and wait for completion
                  const authResult = await this.openOAuthWindowAndWait(
                    newServer.oauthUrl,
                    newServer.identifier,
                  );

                  if (authResult.success) {
                    // OAuth successful
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
                  } else {
                    // OAuth cancelled or failed
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
                } else {
                  // Server created but neither authenticated nor has OAuth URL
                  return {
                    content: `Klavis tool "${klavisTypeInfo.label}" was created but requires additional setup.`,
                    state: {
                      installed: false,
                      isKlavis: true,
                      pluginId: identifier,
                      pluginName: klavisTypeInfo.label,
                      serverStatus: 'pending_auth',
                      success: true,
                    } as InstallPluginState,
                    success: true,
                  };
                }
              }

              return {
                content: `Failed to connect Klavis tool: ${klavisTypeInfo.label}`,
                error: 'Failed to create Klavis server',
                state: {
                  installed: false,
                  pluginId: identifier,
                  success: false,
                } as InstallPluginState,
                success: false,
              };
            }
          }
        }

        // Check if it's a LobehubSkill provider
        const isLobehubSkillEnabled =
          typeof window !== 'undefined' &&
          window.global_serverConfigStore?.getState()?.serverConfig?.enableLobehubSkill;

        if (isLobehubSkillEnabled) {
          // Check if this is a LobehubSkill provider
          const lobehubSkillServer = lobehubSkillStoreSelectors
            .getServers(toolState)
            .find((s) => s.identifier === identifier);

          // Find LobehubSkill provider info from LOBEHUB_SKILL_PROVIDERS
          const lobehubSkillProviderInfo = LOBEHUB_SKILL_PROVIDERS.find((p) => p.id === identifier);

          if (lobehubSkillProviderInfo) {
            // This is a LobehubSkill provider
            if (lobehubSkillServer) {
              // Server exists
              if (lobehubSkillServer.status === LobehubSkillStatus.CONNECTED) {
                // Already connected, just enable the plugin
                const agentState = getAgentStoreState();
                const currentPlugins =
                  agentSelectors.getAgentConfigById(agentId)(agentState).plugins || [];

                if (!currentPlugins.includes(identifier)) {
                  await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
                    plugins: [...currentPlugins, identifier],
                  });
                }

                return {
                  content: `Successfully enabled LobehubSkill provider: ${lobehubSkillProviderInfo.label}`,
                  state: {
                    installed: true,
                    isLobehubSkill: true,
                    pluginId: identifier,
                    pluginName: lobehubSkillProviderInfo.label,
                    serverStatus: 'connected',
                    success: true,
                  } as InstallPluginState,
                  success: true,
                };
              } else {
                // Server exists but not connected - need to reconnect via OAuth
                try {
                  // Get OAuth authorization URL with correct redirectUri
                  const redirectUri =
                    typeof window !== 'undefined'
                      ? `${window.location.origin}/oauth/callback/success?provider=${encodeURIComponent(identifier)}`
                      : undefined;
                  const authInfo = await getToolStoreState().getLobehubSkillAuthorizeUrl(
                    identifier,
                    {
                      redirectUri,
                    },
                  );

                  if (!authInfo.authorizeUrl) {
                    return {
                      content: `LobehubSkill provider "${lobehubSkillProviderInfo.label}" requires OAuth authorization but no authorization URL is available.`,
                      state: {
                        installed: false,
                        isLobehubSkill: true,
                        pluginId: identifier,
                        pluginName: lobehubSkillProviderInfo.label,
                        serverStatus: lobehubSkillServer.status,
                        success: false,
                      } as InstallPluginState,
                      success: false,
                    };
                  }

                  // Open OAuth window and wait for authorization
                  const authResult = await this.openLobehubSkillOAuthWindowAndWait(
                    authInfo.authorizeUrl,
                    identifier,
                  );

                  if (authResult.success) {
                    // OAuth successful, enable the plugin
                    const agentState = getAgentStoreState();
                    const currentPlugins =
                      agentSelectors.getAgentConfigById(agentId)(agentState).plugins || [];

                    if (!currentPlugins.includes(identifier)) {
                      await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
                        plugins: [...currentPlugins, identifier],
                      });
                    }

                    return {
                      content: `Successfully reconnected and enabled LobehubSkill provider: ${lobehubSkillProviderInfo.label}`,
                      state: {
                        installed: true,
                        isLobehubSkill: true,
                        pluginId: identifier,
                        pluginName: lobehubSkillProviderInfo.label,
                        serverStatus: 'connected',
                        success: true,
                      } as InstallPluginState,
                      success: true,
                    };
                  } else {
                    // OAuth cancelled or failed
                    return {
                      content: `OAuth authorization was cancelled or failed for LobehubSkill provider: ${lobehubSkillProviderInfo.label}. Please try again.`,
                      state: {
                        installed: false,
                        isLobehubSkill: true,
                        pluginId: identifier,
                        pluginName: lobehubSkillProviderInfo.label,
                        serverStatus: lobehubSkillServer.status,
                        success: false,
                      } as InstallPluginState,
                      success: false,
                    };
                  }
                } catch (authError) {
                  const err = authError as Error;
                  return {
                    content: `Failed to reconnect LobehubSkill provider "${lobehubSkillProviderInfo.label}": ${err.message}`,
                    error: authError,
                    state: {
                      error: err.message,
                      installed: false,
                      isLobehubSkill: true,
                      pluginId: identifier,
                      pluginName: lobehubSkillProviderInfo.label,
                      serverStatus: lobehubSkillServer.status,
                      success: false,
                    } as InstallPluginState,
                    success: false,
                  };
                }
              }
            } else {
              // Server doesn't exist - need to initiate OAuth authorization
              try {
                // Get OAuth authorization URL with correct redirectUri
                const redirectUri =
                  typeof window !== 'undefined'
                    ? `${window.location.origin}/oauth/callback/success?provider=${encodeURIComponent(identifier)}`
                    : undefined;
                const authInfo = await getToolStoreState().getLobehubSkillAuthorizeUrl(identifier, {
                  redirectUri,
                });

                if (!authInfo.authorizeUrl) {
                  return {
                    content: `LobehubSkill provider "${lobehubSkillProviderInfo.label}" requires OAuth authorization but no authorization URL is available.`,
                    state: {
                      installed: false,
                      isLobehubSkill: true,
                      pluginId: identifier,
                      pluginName: lobehubSkillProviderInfo.label,
                      serverStatus: 'not_connected',
                      success: false,
                    } as InstallPluginState,
                    success: false,
                  };
                }

                // Open OAuth window and wait for authorization
                const authResult = await this.openLobehubSkillOAuthWindowAndWait(
                  authInfo.authorizeUrl,
                  identifier,
                );

                if (authResult.success) {
                  // OAuth successful, enable the plugin
                  const agentState = getAgentStoreState();
                  const currentPlugins =
                    agentSelectors.getAgentConfigById(agentId)(agentState).plugins || [];

                  if (!currentPlugins.includes(identifier)) {
                    await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
                      plugins: [...currentPlugins, identifier],
                    });
                  }

                  return {
                    content: `Successfully connected and enabled LobehubSkill provider: ${lobehubSkillProviderInfo.label}`,
                    state: {
                      installed: true,
                      isLobehubSkill: true,
                      pluginId: identifier,
                      pluginName: lobehubSkillProviderInfo.label,
                      serverStatus: 'connected',
                      success: true,
                    } as InstallPluginState,
                    success: true,
                  };
                } else {
                  // OAuth cancelled or failed
                  return {
                    content: `OAuth authorization was cancelled or failed for LobehubSkill provider: ${lobehubSkillProviderInfo.label}. Please try again.`,
                    state: {
                      installed: false,
                      isLobehubSkill: true,
                      pluginId: identifier,
                      pluginName: lobehubSkillProviderInfo.label,
                      serverStatus: 'not_connected',
                      success: false,
                    } as InstallPluginState,
                    success: false,
                  };
                }
              } catch (authError) {
                const err = authError as Error;
                return {
                  content: `Failed to authorize LobehubSkill provider "${lobehubSkillProviderInfo.label}": ${err.message}`,
                  error: authError,
                  state: {
                    error: err.message,
                    installed: false,
                    isLobehubSkill: true,
                    pluginId: identifier,
                    pluginName: lobehubSkillProviderInfo.label,
                    serverStatus: 'not_connected',
                    success: false,
                  } as InstallPluginState,
                  success: false,
                };
              }
            }
          }
        }

        // Not a Klavis or LobehubSkill tool, check if it's a builtin tool
        const builtinTools = builtinToolSelectors.metaList(toolState);
        const builtinTool = builtinTools.find((t) => t.identifier === identifier);

        if (builtinTool) {
          // It's a builtin tool, just enable it
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
          error: 'Tool not found',
          state: {
            installed: false,
            pluginId: identifier,
            success: false,
          } as InstallPluginState,
          success: false,
        };
      }

      // Source is 'market' - MCP marketplace plugin
      // Check if already installed
      const isInstalled = pluginSelectors.isPluginInstalled(identifier)(toolState);

      if (isInstalled) {
        // Already installed, just enable it for the agent
        const agentState = getAgentStoreState();
        const currentPlugins = agentSelectors.getAgentConfigById(agentId)(agentState).plugins || [];

        if (!currentPlugins.includes(identifier)) {
          await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
            plugins: [...currentPlugins, identifier],
          });
        }

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

      // Plugin needs to be installed - trigger actual installation from market
      try {
        // Call the store's installMCPPlugin to trigger the real installation flow
        const installSuccess = await getToolStoreState().installMCPPlugin(identifier);

        if (installSuccess) {
          // Installation successful, enable it for the agent
          const agentState = getAgentStoreState();
          const currentPlugins =
            agentSelectors.getAgentConfigById(agentId)(agentState).plugins || [];

          if (!currentPlugins.includes(identifier)) {
            await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
              plugins: [...currentPlugins, identifier],
            });
          }

          // Refresh tool state to get the installed plugin info
          await getToolStoreState().refreshPlugins();
          const freshToolState = getToolStoreState();
          const installedPlugin =
            pluginSelectors.getInstalledPluginById(identifier)(freshToolState);

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
        } else {
          // Installation failed or was cancelled
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
      } catch (installError) {
        const err = installError as Error;
        return {
          content: `Failed to install MCP plugin "${identifier}": ${err.message}`,
          error: installError,
          state: {
            error: err.message,
            installed: false,
            pluginId: identifier,
            success: false,
          } as InstallPluginState,
          success: false,
        };
      }
    } catch (error) {
      const err = error as Error;
      return {
        content: `Failed to install plugin: ${err.message}`,
        error,
        state: {
          error: err.message,
          installed: false,
          pluginId: identifier,
          success: false,
        } as InstallPluginState,
        success: false,
      };
    }
  }
}
