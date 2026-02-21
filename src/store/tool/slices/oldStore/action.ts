import { type LobeTool } from '@lobechat/types';
import { uniqBy } from 'es-toolkit/compat';
import { t } from 'i18next';
import { produce } from 'immer';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { notification } from '@/components/AntdStaticMethods';
import { mutate } from '@/libs/swr';
import { pluginService } from '@/services/plugin';
import { toolService } from '@/services/tool';
import { globalHelpers } from '@/store/global/helpers';
import { pluginStoreSelectors } from '@/store/tool/selectors';
import { type StoreSetter } from '@/store/types';
import {
  type DiscoverPluginItem,
  type PluginListResponse,
  type PluginQueryParams,
} from '@/types/discover';
import { type PluginInstallError } from '@/types/tool/plugin';
import { sleep } from '@/utils/sleep';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { type PluginInstallProgress, type PluginStoreState } from './initialState';
import { PluginInstallStep } from './initialState';

const n = setNamespace('pluginStore');

const INSTALLED_PLUGINS = 'loadInstalledPlugins';

type Setter = StoreSetter<ToolStore>;
export const createPluginStoreSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new PluginStoreActionImpl(set, get, _api);

export class PluginStoreActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  installOldPlugin = async (
    name: string,
    type: 'plugin' | 'customPlugin' = 'plugin',
  ): Promise<void> => {
    const plugin = pluginStoreSelectors.getPluginById(name)(this.#get());
    if (!plugin) return;

    const { updateInstallLoadingState, refreshPlugins, updatePluginInstallProgress } = this.#get();

    try {
      // Start installation process
      updateInstallLoadingState(name, true);

      // Step 1: Fetch plugin manifest
      updatePluginInstallProgress(name, {
        progress: 25,
        step: PluginInstallStep.FETCHING_MANIFEST,
      });

      const data = await toolService.getToolManifest(plugin.manifest);

      // Step 2: Install plugin
      updatePluginInstallProgress(name, {
        progress: 60,
        step: PluginInstallStep.INSTALLING_PLUGIN,
      });

      await pluginService.installPlugin({ identifier: plugin.identifier, manifest: data, type });

      updatePluginInstallProgress(name, {
        progress: 85,
        step: PluginInstallStep.INSTALLING_PLUGIN,
      });

      await refreshPlugins();

      // Step 4: Complete installation
      updatePluginInstallProgress(name, {
        progress: 100,
        step: PluginInstallStep.COMPLETED,
      });

      // Briefly show completion status then clear progress
      await sleep(1000);

      updatePluginInstallProgress(name, undefined);
      updateInstallLoadingState(name, undefined);
    } catch (error) {
      console.error(error);

      const err = error as PluginInstallError;

      // Set error state
      updatePluginInstallProgress(name, {
        error: err.message,
        progress: 0,
        step: PluginInstallStep.ERROR,
      });

      updateInstallLoadingState(name, undefined);

      notification.error({
        description: t(`error.${err.message}`, { ns: 'plugin' }),
        message: t('error.installError', { name: plugin.title, ns: 'plugin' }),
      });
    }
  };

  installPlugin = async (
    name: string,
    type: 'plugin' | 'customPlugin' = 'plugin',
  ): Promise<void> => {
    const plugin = pluginStoreSelectors.getPluginById(name)(this.#get());
    if (!plugin) return;

    const { updateInstallLoadingState, refreshPlugins } = this.#get();
    try {
      updateInstallLoadingState(name, true);
      const data = await toolService.getToolManifest(plugin.manifest);

      await pluginService.installPlugin({ identifier: plugin.identifier, manifest: data, type });
      await refreshPlugins();

      updateInstallLoadingState(name, undefined);
    } catch (error) {
      console.error(error);

      const err = error as PluginInstallError;

      updateInstallLoadingState(name, undefined);

      notification.error({
        description: t(`error.${err.message}`, { ns: 'plugin' }),
        message: t('error.installError', { name: plugin.title, ns: 'plugin' }),
      });
    }
  };

  installPlugins = async (plugins: string[]): Promise<void> => {
    const { installPlugin } = this.#get();

    await Promise.all(plugins.map((identifier) => installPlugin(identifier)));
  };

  loadMorePlugins = (): void => {
    const { oldPluginItems, pluginTotalCount, currentPluginPage } = this.#get();

    // Check if there is more data to load
    if (oldPluginItems.length < (pluginTotalCount || 0)) {
      this.#set(
        produce((draft: PluginStoreState) => {
          draft.currentPluginPage = currentPluginPage + 1;
        }),
        false,
        n('loadMorePlugins'),
      );
    }
  };

  loadPluginStore = async (): Promise<DiscoverPluginItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();

    const data = await toolService.getOldPluginList({
      locale,
      page: 1,
      pageSize: 50,
    });

    this.#set({ oldPluginItems: data.items }, false, n('loadPluginList'));

    return data.items;
  };

  refreshPlugins = async (): Promise<void> => {
    await mutate(INSTALLED_PLUGINS);
  };

  resetPluginList = (keywords?: string): void => {
    this.#set(
      produce((draft: PluginStoreState) => {
        draft.oldPluginItems = [];
        draft.currentPluginPage = 1;
        draft.pluginSearchKeywords = keywords;
      }),
      false,
      n('resetPluginList'),
    );
  };

  uninstallPlugin = async (identifier: string): Promise<void> => {
    await pluginService.uninstallPlugin(identifier);
    await this.#get().refreshPlugins();
  };

  updateInstallLoadingState = (key: string, value: boolean | undefined): void => {
    this.#set(
      produce((draft: PluginStoreState) => {
        draft.pluginInstallLoading[key] = value;
      }),
      false,
      n('updateInstallLoadingState'),
    );
  };

  updatePluginInstallProgress = (
    identifier: string,
    progress: PluginInstallProgress | undefined,
  ): void => {
    this.#set(
      produce((draft: PluginStoreState) => {
        draft.pluginInstallProgress[identifier] = progress;
      }),
      false,
      n(`updatePluginInstallProgress/${progress?.step || 'clear'}`),
    );
  };

  useFetchInstalledPlugins = (enabled: boolean): SWRResponse<LobeTool[]> => {
    return useSWR<LobeTool[]>(
      enabled ? INSTALLED_PLUGINS : null,
      pluginService.getInstalledPlugins,
      {
        fallbackData: [],
        onSuccess: (data) => {
          this.#set(
            { installedPlugins: data, loadingInstallPlugins: false },
            false,
            n('useFetchInstalledPlugins'),
          );
        },
        revalidateOnFocus: false,
        suspense: true,
      },
    );
  };

  useFetchPluginList = (params: PluginQueryParams): SWRResponse<PluginListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();

    return useSWR<PluginListResponse>(
      ['useFetchPluginList', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () => toolService.getOldPluginList(params),
      {
        onSuccess: (data) => {
          this.#set(
            produce((draft: PluginStoreState) => {
              draft.pluginSearchLoading = false;

              // Set basic information
              if (!draft.isPluginListInit) {
                draft.activePluginIdentifier = data.items?.[0]?.identifier;
                draft.isPluginListInit = true;
                draft.pluginTotalCount = data.totalCount;
              }

              // Accumulate data logic
              if (params.page === 1) {
                // First page, set directly
                draft.oldPluginItems = uniqBy(data.items, 'identifier');
              } else {
                // Subsequent pages, accumulate data
                draft.oldPluginItems = uniqBy(
                  [...draft.oldPluginItems, ...data.items],
                  'identifier',
                );
              }
            }),
            false,
            n('useFetchPluginList/onSuccess'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  };

  useFetchPluginStore = (): SWRResponse<DiscoverPluginItem[]> => {
    return useSWR<DiscoverPluginItem[]>('loadPluginStore', this.#get().loadPluginStore, {
      revalidateOnFocus: false,
    });
  };
}

export type PluginStoreAction = Pick<PluginStoreActionImpl, keyof PluginStoreActionImpl>;
