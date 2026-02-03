import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { merge } from 'es-toolkit/compat';
import { t } from 'i18next';

import { notification } from '@/components/AntdStaticMethods';
import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import { toolService } from '@/services/tool';
import { pluginHelpers } from '@/store/tool/helpers';
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

    const { refreshPlugins, updateInstallLoadingState } = this.#get();

    try {
      updateInstallLoadingState(id, true);
      let manifest: LobeChatPluginManifest;
      // mean this is a mcp plugin
      if (!!plugin.customParams?.mcp) {
        const url = plugin.customParams?.mcp?.url;
        if (!url) return;

        manifest = await mcpService.getStreamableMcpServerManifest({
          auth: plugin.customParams.mcp.auth,
          headers: plugin.customParams.mcp.headers,
          identifier: plugin.identifier,
          metadata: {
            avatar: plugin.customParams.avatar,
            description: plugin.customParams.description,
          },
          url,
        });
      } else {
        manifest = await toolService.getToolManifest(
          plugin.customParams?.manifestUrl,
          plugin.customParams?.useProxy,
        );
      }
      updateInstallLoadingState(id, false);

      await pluginService.updatePluginManifest(id, manifest);
      await refreshPlugins();
    } catch (error) {
      updateInstallLoadingState(id, false);

      console.error(error);
      const err = error as PluginInstallError;

      const meta = pluginSelectors.getPluginMetaById(id)(this.#get());
      const name = pluginHelpers.getPluginTitle(meta);

      notification.error({
        description: t(`error.${err.message}`, { error: err.cause, ns: 'plugin' }),
        message: t('error.reinstallError', { name, ns: 'plugin' }),
      });
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
