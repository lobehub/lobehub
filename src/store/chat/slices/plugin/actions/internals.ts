/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import { ToolArgumentsRepairer, ToolNameResolver } from '@lobechat/context-engine';
import { type ChatToolPayload, type MessageToolCall } from '@lobechat/types';
import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';

import { type ChatStore } from '@/store/chat/store';
import { useToolStore } from '@/store/tool';
import {
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { type StoreSetter } from '@/store/types';
import { builtinTools } from '@/tools';

/**
 * Internal utility methods and runtime state management
 * These are building blocks used by other actions
 */

type Setter = StoreSetter<ChatStore>;
export const pluginInternals = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new PluginInternalsActionImpl(set, get, _api);

export class PluginInternalsActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_transformToolCalls = (toolCalls: MessageToolCall[]): ChatToolPayload[] => {
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
  };
}

export type PluginInternalsAction = Pick<
  PluginInternalsActionImpl,
  keyof PluginInternalsActionImpl
>;
