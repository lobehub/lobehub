import { type LobeTool, type ToolManifest } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { type LobeToolCustomPlugin } from '@/types/tool/plugin';

/**
 * Legacy `user_installed_plugins` rows. There is no create call: new MCP
 * installs go through the connector service (`connector.create`).
 */
export class PluginService {
  getInstalledPlugins = (): Promise<LobeTool[]> => {
    return lambdaClient.plugin.getPlugins.query();
  };

  uninstallPlugin = async (identifier: string): Promise<void> => {
    await lambdaClient.plugin.removePlugin.mutate({ id: identifier });
  };

  updatePlugin = async (id: string, value: Partial<LobeToolCustomPlugin>): Promise<void> => {
    await lambdaClient.plugin.updatePlugin.mutate({
      customParams: value.customParams,
      id,
      manifest: value.manifest,
      settings: value.settings,
    });
  };

  updatePluginManifest = async (id: string, manifest: ToolManifest): Promise<void> => {
    await lambdaClient.plugin.updatePlugin.mutate({ id, manifest });
  };

  updatePluginSettings = async (id: string, settings: any, signal?: AbortSignal): Promise<void> => {
    await lambdaClient.plugin.updatePlugin.mutate({ id, settings }, { signal });
  };
}

export const pluginService = new PluginService();
