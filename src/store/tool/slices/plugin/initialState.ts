import { type LobeTool } from '@lobechat/types';

import { type PluginInstallError } from '@/types/tool/plugin';

export type PluginsSettings = Record<string, any>;

export interface PluginState {
  installedPlugins: LobeTool[];
  loadingInstallPlugins: boolean;
  pluginInstallErrors: Record<string, PluginInstallError | undefined>;
  pluginInstallLoading: Record<string, boolean | undefined>;
  pluginsSettings: PluginsSettings;
  updatePluginSettingsSignal?: AbortController;
}

export const initialPluginState: PluginState = {
  installedPlugins: [],
  loadingInstallPlugins: true,
  pluginInstallErrors: {},
  pluginInstallLoading: {},
  pluginsSettings: {},
};
