import type {LobeTool} from '@lobechat/types';
import type {LobeChatPluginManifest} from '@lobehub/chat-plugin-sdk';

import { lambdaClient } from '@/libs/trpc/client';
import type {LobeToolCustomPlugin} from '@/types/tool/plugin';

export interface InstallPluginParams {
  customParams?: Record<string, any>;
  identifier: string;
  manifest: LobeChatPluginManifest;
  settings?: Record<string, any>;
  type: 'plugin' | 'customPlugin';
}

export class PluginService {
  installPlugin = async (plugin: InstallPluginParams): Promise<void> => {
    await lambdaClient.plugin.createOrInstallPlugin.mutate(plugin);
  };

  getInstalledPlugins = (): Promise<LobeTool[]> => {
    return lambdaClient.plugin.getPlugins.query();
  };

  uninstallPlugin = async (identifier: string): Promise<void> => {
    await lambdaClient.plugin.removePlugin.mutate({ id: identifier });
  };

  createCustomPlugin = async (customPlugin: LobeToolCustomPlugin): Promise<void> => {
    await lambdaClient.plugin.createPlugin.mutate({ ...customPlugin, type: 'customPlugin' });
  };

  updatePlugin = async (id: string, value: Partial<LobeToolCustomPlugin>): Promise<void> => {
    await lambdaClient.plugin.updatePlugin.mutate({
      customParams: value.customParams,
      id,
      manifest: value.manifest,
      settings: value.settings,
    });
  };

  updatePluginManifest = async (id: string, manifest: LobeChatPluginManifest): Promise<void> => {
    await lambdaClient.plugin.updatePlugin.mutate({ id, manifest });
  };

  removeAllPlugins = async (): Promise<void> => {
    await lambdaClient.plugin.removeAllPlugins.mutate();
  };

  updatePluginSettings = async (id: string, settings: any, signal?: AbortSignal): Promise<void> => {
    await lambdaClient.plugin.updatePlugin.mutate({ id, settings }, { signal });
  };
}

export const pluginService = new PluginService();
