import { merge } from 'es-toolkit/compat';

import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import { type StoreSetter } from '@/store/types';
import { type LobeToolCustomPlugin, type PluginInstallError } from '@/types/tool/plugin';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { pluginSelectors } from '../plugin/selectors';
import { defaultCustomPlugin } from './initialState';

const n = setNamespace('customPlugin');

type Setter = StoreSetter<ToolStore>;
export const createCustomPluginSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new CustomPluginActionImpl(set, get, _api);

export class CustomPluginActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  installCustomPlugin = async (value: LobeToolCustomPlugin): Promise<void> => {
    await pluginService.createCustomPlugin(value);

    await this.#get().refreshPlugins();
    this.#set({ newCustomPlugin: defaultCustomPlugin }, false, n('saveToCustomPluginList'));
  };

  reinstallCustomPlugin = async (id: string): Promise<void> => {
    const plugin = pluginSelectors.getCustomPluginById(id)(this.#get());
    if (!plugin) return;

    const { refreshPlugins, updateInstallError, updateInstallLoadingState } = this.#get();

    const url = plugin.customParams?.mcp?.url;
    if (!plugin.customParams?.mcp || !url) return;

    try {
      updateInstallError(id, undefined);
      updateInstallLoadingState(id, true);
      const manifest = await mcpService.getStreamableMcpServerManifest({
        auth: plugin.customParams.mcp.auth,
        headers: plugin.customParams.mcp.headers,
        identifier: plugin.identifier,
        metadata: {
          avatar: plugin.customParams.avatar,
          description: plugin.customParams.description,
        },
        url,
      });
      await pluginService.updatePluginManifest(id, manifest);
      await refreshPlugins();
    } catch (error) {
      console.error(error);
      const err = error as PluginInstallError;
      updateInstallError(id, { cause: err.cause, message: err.message });
    } finally {
      updateInstallLoadingState(id, false);
    }
  };

  uninstallCustomPlugin = async (id: string): Promise<void> => {
    await pluginService.uninstallPlugin(id);
    await this.#get().refreshPlugins();
  };

  updateCustomPlugin = async (id: string, value: LobeToolCustomPlugin): Promise<void> => {
    const { reinstallCustomPlugin } = this.#get();
    // 1. Update list item information
    await pluginService.updatePlugin(id, value);

    // 2. Reinstall plugin
    await reinstallCustomPlugin(id);
  };

  updateNewCustomPlugin = (newCustomPlugin: Partial<LobeToolCustomPlugin>): void => {
    this.#set(
      { newCustomPlugin: merge({}, this.#get().newCustomPlugin, newCustomPlugin) },
      false,
      n('updateNewDevPlugin'),
    );
  };
}

export type CustomPluginAction = Pick<CustomPluginActionImpl, keyof CustomPluginActionImpl>;
