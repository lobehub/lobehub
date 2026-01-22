/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { ToolArgumentsRepairer, ToolNameResolver } from '@lobechat/context-engine';
import { type ChatToolPayload, type MessageToolCall } from '@lobechat/types';
import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { useToolStore } from '@/store/tool';
import {
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { builtinTools } from '@/tools';

/**
 * Internal utility methods and runtime state management
 * These are building blocks used by other actions
 */
export interface PluginInternalsAction {
  /**
   * Transform tool calls from runtime format to storage format
   */
  internal_transformToolCalls: (toolCalls: MessageToolCall[]) => ChatToolPayload[];
}

export const pluginInternals: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  PluginInternalsAction
> = () => ({
  internal_transformToolCalls: (toolCalls) => {
    const toolNameResolver = new ToolNameResolver();

    // Build manifests map from tool store
    const toolStoreState = useToolStore.getState();
    const manifests: Record<string, LobeChatPluginManifest> = {};

    // Track source for each identifier
    const sourceMap: Record<string, 'builtin' | 'plugin' | 'mcp' | 'klavis' | 'lobehubSkill'> = {};

    // Get all installed plugins
    const installedPlugins = pluginSelectors.installedPlugins(toolStoreState);
    for (const plugin of installedPlugins) {
      if (plugin.manifest) {
        manifests[plugin.identifier] = plugin.manifest as LobeChatPluginManifest;
        // Check if this plugin has MCP params
        sourceMap[plugin.identifier] = plugin.customParams?.mcp ? 'mcp' : 'plugin';
      }
    }

    // Get all builtin tools
    for (const tool of builtinTools) {
      if (tool.manifest) {
        manifests[tool.identifier] = tool.manifest as LobeChatPluginManifest;
        sourceMap[tool.identifier] = 'builtin';
      }
    }

    // Get all Klavis tools
    const klavisTools = klavisStoreSelectors.klavisAsLobeTools(toolStoreState);
    for (const tool of klavisTools) {
      if (tool.manifest) {
        manifests[tool.identifier] = tool.manifest as LobeChatPluginManifest;
        sourceMap[tool.identifier] = 'klavis';
      }
    }

    // Get all LobeHub Skill tools
    const lobehubSkillTools = lobehubSkillStoreSelectors.lobehubSkillAsLobeTools(toolStoreState);
    for (const tool of lobehubSkillTools) {
      if (tool.manifest) {
        manifests[tool.identifier] = tool.manifest as LobeChatPluginManifest;
        sourceMap[tool.identifier] = 'lobehubSkill';
      }
    }

    // Resolve tool calls and add source field
    const resolved = toolNameResolver.resolve(toolCalls, manifests);

    return resolved.map((payload) => {
      // Parse and repair arguments if needed
      const manifest = manifests[payload.identifier];
      const repairer = new ToolArgumentsRepairer(manifest);
      const repairedArgs = repairer.parse(payload.apiName, payload.arguments);

      return {
        ...payload,
        arguments: JSON.stringify(repairedArgs),
        source: sourceMap[payload.identifier],
      };
    });
  },
});
