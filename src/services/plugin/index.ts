import { type LobeTool } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

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
}

export const pluginService = new PluginService();
