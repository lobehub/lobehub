import { isDesktop } from '@lobechat/const';
import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { uniq } from 'es-toolkit/compat';

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
  // first try to find meta from store
  const item = s.oldPluginItems.find((i) => i.identifier === id);
  if (item)
    return {
      avatar: item.avatar,
      description: item.description,
      tags: item.tags,
      title: item.title,
    };

  // then use installed meta
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
  uniq(
    [s.installedPlugins.map((i) => i.identifier), s.oldPluginItems.map((i) => i.identifier)].flat(),
  );

const installedPluginManifestList = (s: ToolStoreState) =>
  installedPlugins(s)
    .map((i) => i.manifest as LobeChatPluginManifest)
    .filter((i) => !!i);

const installedPluginMetaList = (s: ToolStoreState) =>
  installedPlugins(s)
    // Filter out Klavis plugins (they have their own display location)
    .filter((p) => !p.customParams?.klavis)
    // Filter out stdio MCP plugins on non-desktop (stdio requires Electron IPC)
    .filter((p) => isDesktop || p.customParams?.mcp?.type !== 'stdio')
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
