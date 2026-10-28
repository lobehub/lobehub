import type { ComposioAppType, LobehubSkillProviderType } from '@lobechat/const';
import { resolveConnectorCatalogItem } from '@lobechat/const';
import { type BuiltinToolResult, getPluginMode, upsertPluginMode } from '@lobechat/types';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors/selectors';
import { getToolStoreState } from '@/store/tool';
import {
  builtinToolSelectors,
  composioStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import type { ComposioServer } from '@/store/tool/slices/composioStore/types';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore/types';
import type { LobehubSkillServer } from '@/store/tool/slices/lobehubSkillStore/types';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import type { IAgentService, InstallPluginParams, InstallPluginState } from '../types';
import { handleErrorWithState } from './errors';
import { openComposioOAuthWindowAndWait, openLobehubSkillOAuthWindowAndWait } from './oauthWindow';

/**
 * Install a plugin
 */
export const installPlugin = async (
  agentService: IAgentService,
  agentId: string,
  params: InstallPluginParams,
): Promise<BuiltinToolResult> => {
  const { identifier, source } = params;

  // Each branch is `return await`ed: a bare `return` hands back the pending
  // promise, so a store rejection would skip this catch and reach the caller
  // as a thrown error instead of a failed install result.
  try {
    const toolState = getToolStoreState();

    if (source === 'official') {
      const isComposioEnabled =
        typeof window !== 'undefined' &&
        window.global_serverConfigStore?.getState()?.serverConfig?.enableComposio;
      const isLobehubSkillEnabled =
        typeof window !== 'undefined' &&
        window.global_serverConfigStore?.getState()?.serverConfig?.enableLobehubSkill;
      const connector = resolveConnectorCatalogItem(identifier, {
        composio: Boolean(isComposioEnabled),
        lobehub: Boolean(isLobehubSkillEnabled),
      });

      if (connector?.type === 'composio') {
        const composioServer = composioStoreSelectors
          .getServers(toolState)
          .find((s) => s.identifier === identifier);
        return await handleComposioInstall(
          agentService,
          agentId,
          identifier,
          connector.serverType,
          composioServer,
        );
      }

      if (connector?.type === 'lobehub') {
        const lobehubSkillServer = lobehubSkillStoreSelectors
          .getServers(toolState)
          .find((s) => s.identifier === identifier);
        return await handleLobehubSkillInstall(
          agentService,
          agentId,
          identifier,
          connector.provider,
          lobehubSkillServer,
        );
      }

      // Check if it's a builtin tool
      const builtinTools = builtinToolSelectors.metaList(toolState);
      const builtinTool = builtinTools.find((t) => t.identifier === identifier);

      if (builtinTool) {
        await enablePluginForAgent(agentService, agentId, identifier);

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
    return await handleMarketPluginInstall(agentService, agentId, identifier);
  } catch (error) {
    const err = error as Error;
    return handleErrorWithState(error, 'Failed to install plugin', {
      error: err.message,
      installed: false,
      pluginId: identifier,
      success: false,
    } as InstallPluginState);
  }
};

/**
 * Ensure the agent config is loaded into the Zustand store.
 * When operating on agents that aren't currently open/active,
 * their config won't be in the agentMap. This fetches and dispatches it.
 */
export const ensureAgentLoaded = async (
  agentService: IAgentService,
  agentId: string,
): Promise<void> => {
  const state = getAgentStoreState();
  const existing = state.agentMap[agentId];
  if (existing) return;

  const config = await agentService.getAgentConfigById(agentId);
  if (config) {
    getAgentStoreState().internal_dispatchAgentMap(agentId, config);
  }
};

const handleComposioInstall = async (
  agentService: IAgentService,
  agentId: string,
  identifier: string,
  composioAppInfo: ComposioAppType,
  composioServer?: ComposioServer,
): Promise<BuiltinToolResult> => {
  if (composioServer) {
    if (composioServer.status === ComposioServerStatus.ACTIVE) {
      await enablePluginForAgent(agentService, agentId, identifier);
      return {
        content: `Successfully enabled Composio tool: ${composioAppInfo.label}`,
        state: {
          installed: true,
          isComposio: true,
          pluginId: identifier,
          pluginName: composioAppInfo.label,
          serverStatus: 'connected',
          success: true,
        } as InstallPluginState,
        success: true,
      };
    } else if (composioServer.status === ComposioServerStatus.PENDING_AUTH) {
      if (composioServer.redirectUrl) {
        const authResult = await openComposioOAuthWindowAndWait(
          composioServer.redirectUrl,
          identifier,
        );
        if (authResult.success) {
          await enablePluginForAgent(agentService, agentId, identifier);
          return {
            content: `Successfully connected and enabled Composio tool: ${composioAppInfo.label}`,
            state: {
              installed: true,
              isComposio: true,
              pluginId: identifier,
              pluginName: composioAppInfo.label,
              serverStatus: 'connected',
              success: true,
            } as InstallPluginState,
            success: true,
          };
        }
      }
      return {
        content: `OAuth authorization was cancelled or failed for Composio tool: ${composioAppInfo.label}. Please try again.`,
        state: {
          installed: false,
          isComposio: true,
          pluginId: identifier,
          pluginName: composioAppInfo.label,
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
      content: `Cannot connect Composio tool: User not logged in.`,
      error: { message: 'User not logged in', type: 'AuthRequired' },
      state: { installed: false, pluginId: identifier, success: false } as InstallPluginState,
      success: false,
    };
  }

  const newServer = await getToolStoreState().createComposioConnection({
    appSlug: composioAppInfo.appSlug,
    identifier,
    label: composioAppInfo.label,
  });

  if (newServer) {
    // Enable the plugin only once the connection is actually usable. Enabling
    // before OAuth completes would leave an enabled-but-unauthorized tool on
    // the agent if the user cancels the authorization.
    if (newServer.status === ComposioServerStatus.ACTIVE) {
      await enablePluginForAgent(agentService, agentId, identifier);
      await getToolStoreState().refreshComposioConnectionStatus(newServer.identifier);
      return {
        content: `Successfully connected and enabled Composio tool: ${composioAppInfo.label}`,
        state: {
          installed: true,
          isComposio: true,
          pluginId: identifier,
          pluginName: composioAppInfo.label,
          serverStatus: 'connected',
          success: true,
        } as InstallPluginState,
        success: true,
      };
    } else if (newServer.redirectUrl) {
      const authResult = await openComposioOAuthWindowAndWait(
        newServer.redirectUrl,
        newServer.identifier,
      );
      if (authResult.success) {
        await enablePluginForAgent(agentService, agentId, identifier);
        return {
          content: `Successfully connected and enabled Composio tool: ${composioAppInfo.label}`,
          state: {
            installed: true,
            isComposio: true,
            pluginId: identifier,
            pluginName: composioAppInfo.label,
            serverStatus: 'connected',
            success: true,
          } as InstallPluginState,
          success: true,
        };
      }
    }
  }

  return {
    content: `Failed to connect Composio tool: ${composioAppInfo.label}`,
    error: { message: 'Failed to create Composio connection', type: 'ComposioError' },
    state: {
      installed: false,
      pluginId: identifier,
      success: false,
    } as InstallPluginState,
    success: false,
  };
};

const handleLobehubSkillInstall = async (
  agentService: IAgentService,
  agentId: string,
  identifier: string,
  providerInfo: LobehubSkillProviderType,
  server?: LobehubSkillServer,
): Promise<BuiltinToolResult> => {
  if (server?.status === LobehubSkillStatus.CONNECTED) {
    await enablePluginForAgent(agentService, agentId, identifier);
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
  // Skip redirectUri on desktop (app:// protocol) since the system browser can't navigate to it
  const redirectUri =
    typeof window !== 'undefined' && window.location.protocol.startsWith('http')
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

  const authResult = await openLobehubSkillOAuthWindowAndWait(authInfo.authorizeUrl, identifier);

  if (authResult.success) {
    await enablePluginForAgent(agentService, agentId, identifier);
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
};

const handleMarketPluginInstall = async (
  agentService: IAgentService,
  agentId: string,
  identifier: string,
): Promise<BuiltinToolResult> => {
  const toolState = getToolStoreState();
  const isInstalled = pluginSelectors.isPluginInstalled(identifier)(toolState);

  if (isInstalled) {
    await enablePluginForAgent(agentService, agentId, identifier);
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
    await enablePluginForAgent(agentService, agentId, identifier);
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
};

export const enablePluginForAgent = async (
  agentService: IAgentService,
  agentId: string,
  pluginId: string,
): Promise<void> => {
  await ensureAgentLoaded(agentService, agentId);
  const agentState = getAgentStoreState();
  const currentPlugins = agentSelectors.getAgentConfigById(agentId)(agentState)?.plugins;

  // upsertPluginMode preserves an already-matching entry as-is and flips a
  // disabled entry back to pinned in place, instead of blindly pushing a
  // duplicate bare-string identifier.
  if (getPluginMode(currentPlugins, pluginId) !== 'pinned') {
    await getAgentStoreState().optimisticUpdateAgentConfig(agentId, {
      plugins: upsertPluginMode(currentPlugins, pluginId, 'pinned'),
    });
  }
};
