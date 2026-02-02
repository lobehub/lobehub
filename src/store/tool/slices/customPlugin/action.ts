import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { merge } from 'es-toolkit/compat';
import { t } from 'i18next';
import { type StateCreator } from 'zustand/vanilla';

import { notification } from '@/components/AntdStaticMethods';
import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import { toolService } from '@/services/tool';
import { pluginHelpers } from '@/store/tool/helpers';
import { type LobeToolCustomPlugin, type PluginInstallError } from '@/types/tool/plugin';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { pluginSelectors } from '../plugin/selectors';
import { defaultCustomPlugin } from './initialState';

const n = setNamespace('customPlugin');

export interface CustomPluginAction {
  installCustomPlugin: (value: LobeToolCustomPlugin) => Promise<void>;
  reinstallCustomPlugin: (id: string) => Promise<void>;
  uninstallCustomPlugin: (id: string) => Promise<void>;
  updateCustomPlugin: (id: string, value: LobeToolCustomPlugin) => Promise<void>;
  updateNewCustomPlugin: (value: Partial<LobeToolCustomPlugin>) => void;
}

export const createCustomPluginSlice: StateCreator<
  ToolStore,
  [['zustand/devtools', never]],
  [],
  CustomPluginAction
> = (set, get) => ({
  installCustomPlugin: async (value) => {
    await pluginService.createCustomPlugin(value);

    await get().refreshPlugins();
    set({ newCustomPlugin: defaultCustomPlugin }, false, n('saveToCustomPluginList'));
  },
  reinstallCustomPlugin: async (id) => {
    const plugin = pluginSelectors.getCustomPluginById(id)(get());
    if (!plugin) return;

    const { refreshPlugins, updateInstallLoadingState } = get();

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

      const meta = pluginSelectors.getPluginMetaById(id)(get());
      const name = pluginHelpers.getPluginTitle(meta);

      notification.error({
        description: t(`error.${err.message}`, { error: err.cause, ns: 'plugin' }),
        message: t('error.reinstallError', { name, ns: 'plugin' }),
      });
    }
  },
  uninstallCustomPlugin: async (id) => {
    await pluginService.uninstallPlugin(id);
    await get().refreshPlugins();
  },

  updateCustomPlugin: async (id, value) => {
    const { reinstallCustomPlugin } = get();
    // 1. Update list item information
    await pluginService.updatePlugin(id, value);

    // 2. Reinstall plugin
    await reinstallCustomPlugin(id);
  },
  updateNewCustomPlugin: (newCustomPlugin) => {
    set(
      { newCustomPlugin: merge({}, get().newCustomPlugin, newCustomPlugin) },
      false,
      n('updateNewDevPlugin'),
    );
  },
});
