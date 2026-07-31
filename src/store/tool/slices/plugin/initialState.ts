import { type LobeTool } from '@lobechat/types';

export type PluginsSettings = Record<string, any>;

export interface PluginState {
  installedPlugins: LobeTool[];
  loadingInstallPlugins: boolean;
  pluginInstallErrors: Record<string, string | undefined>;
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
