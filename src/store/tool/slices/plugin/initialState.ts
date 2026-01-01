import { type LobeTool } from '@lobechat/types';

export type PluginsSettings = Record<string, any>;

export interface PluginState {
  installedPlugins: LobeTool[];
  loadingInstallPlugins: boolean;
  pluginsSettings: PluginsSettings;
  updatePluginSettingsSignal?: AbortController;
}

export const initialPluginState: PluginState = {
  installedPlugins: [],
  loadingInstallPlugins: true,
  pluginsSettings: {},
};
