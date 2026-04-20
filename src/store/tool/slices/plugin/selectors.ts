import { type ToolManifest } from '@lobechat/types';

import { isInstalledPluginAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import { type InstallPluginMeta, type LobeToolCustomPlugin } from '@/types/tool/plugin';

import { type ToolStoreState } from '../../initialState';

const installedPlugins = (s: ToolStoreState) => s.installedPlugins;

const isPluginInstalled = (id: string) => (s: ToolStoreState) =>
  installedPlugins(s).some((i) => i.identifier === id);

const getInstalledPluginById = (id?: string) => (s: ToolStoreState) => {
  if (!id) return;

  return installedPlugins(s).find((p) => p.identifier === id);
};

const getPluginMetaById = (id: string) => (s: ToolStoreState) => {
  return getInstalledPluginById(id)(s)?.manifest?.meta;
};

const getCustomPluginById = (id: string) => (s: ToolStoreState) =>
  installedPlugins(s).find((i) => i.identifier === id && i.type === 'customPlugin') as
    | LobeToolCustomPlugin
    | undefined;

const getToolManifestById = (id: string) => (s: ToolStoreState) =>
  getInstalledPluginById(id)(s)?.manifest;

const getPluginSettingsById = (id: string) => (s: ToolStoreState) =>
  getInstalledPluginById(id)(s)?.settings || {};

const storeAndInstallPluginsIdList = (s: ToolStoreState) =>
  s.installedPlugins.map((i) => i.identifier);

const installedPluginManifestList = (s: ToolStoreState) =>
  installedPlugins(s)
    .map((i) => i.manifest as ToolManifest)
    .filter((i) => !!i);

const installedPluginMetaList = (s: ToolStoreState) =>
  installedPlugins(s)
    // Filter out Klavis plugins (they have their own display location)
    .filter((p) => !p.customParams?.klavis)
    .filter((plugin) => isInstalledPluginAvailableInCurrentEnv(plugin))
    .map<InstallPluginMeta>((p) => ({
      author: p.manifest?.author,
      createdAt: p.manifest?.createdAt || (p.manifest as any)?.createAt,
      homepage: p.manifest?.homepage,
      identifier: p.identifier,
      /*
       * should remove meta
       */
      meta: getPluginMetaById(p.identifier)(s),
      runtimeType: p.runtimeType,
      type: p.source || p.type,
      ...getPluginMetaById(p.identifier)(s),
    }));
const installedCustomPluginMetaList = (s: ToolStoreState) =>
  installedPluginMetaList(s).filter((p) => p.type === 'customPlugin');

const isPluginHasUI = (id: string) => (s: ToolStoreState) => {
  const plugin = getToolManifestById(id)(s);

  return !!plugin?.ui;
};

export const pluginSelectors = {
  getCustomPluginById,
  getInstalledPluginById,
  getPluginMetaById,
  getPluginSettingsById,
  getToolManifestById,
  installedCustomPluginMetaList,
  installedPluginManifestList,
  installedPluginMetaList,
  installedPlugins,
  isPluginHasUI,
  isPluginInstalled,
  storeAndInstallPluginsIdList,
};
