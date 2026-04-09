import { type Schema, type ValidationResult } from '@cfworker/json-schema';
import { type LobeTool } from '@lobechat/types';
import { type SWRResponse } from 'swr';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { useClientDataSWR } from '@/libs/swr';
import { pluginService } from '@/services/plugin';
import { type StoreSetter } from '@/store/types';
import { merge } from '@/utils/merge';

import { type ToolStore } from '../../store';
import { pluginSelectors } from './selectors';

/**
 * Plugin interface
 */

type Setter = StoreSetter<ToolStore>;
export const createPluginSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new PluginActionImpl(set, get, _api);

export class PluginActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  checkPluginsIsInstalled = async (_plugins: string[]): Promise<void> => {
    // Old plugin system has been deprecated, skip auto-installation
  };

  /**
   * Refresh installed plugins from the server and update store state.
   */
  refreshPlugins = async (): Promise<void> => {
    const data = await pluginService.getInstalledPlugins();
    this.#set({ installedPlugins: data }, false, 'refreshPlugins');
  };

  removeAllPlugins = async (): Promise<void> => {
    await pluginService.removeAllPlugins();
    await this.#get().refreshPlugins();
  };

  updateInstallLoadingState = (id: string, loading: boolean | undefined): void => {
    this.#set(
      { pluginInstallLoading: { ...this.#get().pluginInstallLoading, [id]: loading } },
      false,
      'updateInstallLoadingState',
    );
  };

  updateInstallMcpPlugin = async (id: string, value: any): Promise<void> => {
    const installedPlugin = pluginSelectors.getInstalledPluginById(id)(this.#get());

    if (!installedPlugin) return;

    await pluginService.updatePlugin(id, {
      customParams: { mcp: merge(installedPlugin.customParams?.mcp, value) },
    });

    await this.#get().refreshPlugins();
  };

  updatePluginSettings = async <T>(
    id: string,
    settings: Partial<T>,
    options: { override?: boolean } = {},
  ): Promise<void> => {
    const { override } = options;
    const signal = this.#get().updatePluginSettingsSignal;
    if (signal) signal.abort(MESSAGE_CANCEL_FLAT);

    const newSignal = new AbortController();

    const previousSettings = pluginSelectors.getPluginSettingsById(id)(this.#get());
    const nextSettings = override ? settings : merge(previousSettings, settings);

    this.#set({ updatePluginSettingsSignal: newSignal }, false, 'create new Signal');
    await pluginService.updatePluginSettings(id, nextSettings, newSignal.signal);

    await this.#get().refreshPlugins();
  };

  useFetchInstalledPlugins = (enable: boolean): SWRResponse => {
    return useClientDataSWR(
      enable ? 'useFetchInstalledPlugins' : null,
      () => pluginService.getInstalledPlugins(),
      {
        onSuccess: (data: LobeTool[]) => {
          this.#set(
            { installedPlugins: data, loadingInstallPlugins: false },
            false,
            'useFetchInstalledPlugins/onSuccess',
          );
        },
      },
    );
  };

  useCheckPluginsIsInstalled = (enable: boolean, plugins: string[]): SWRResponse => {
    return useClientDataSWR(enable ? plugins : null, this.#get().checkPluginsIsInstalled);
  };

  validatePluginSettings = async (identifier: string): Promise<ValidationResult | undefined> => {
    const manifest = pluginSelectors.getToolManifestById(identifier)(this.#get());
    if (!manifest || !manifest.settings) return;
    const settings = pluginSelectors.getPluginSettingsById(identifier)(this.#get());

    // validate the settings
    const { Validator } = await import('@cfworker/json-schema');
    const validator = new Validator(manifest.settings as Schema);
    const result = validator.validate(settings);

    if (!result.valid) return { errors: result.errors, valid: false };

    return { errors: [], valid: true };
  };
}

export type PluginAction = Pick<PluginActionImpl, keyof PluginActionImpl>;
