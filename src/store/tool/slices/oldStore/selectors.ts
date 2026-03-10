import { PluginStoreTabs } from '@/store/tool/slices/oldStore/initialState';
import { type InstallPluginMeta } from '@/types/tool/plugin';

import { type ToolStoreState } from '../../initialState';

const onlinePluginStore = (s: ToolStoreState) => {
  const installedPluginIds = new Set(s.installedPlugins.map((i) => i.identifier));
  const list =
    s.listType === PluginStoreTabs.Plugin
      ? s.oldPluginItems
      : s.oldPluginItems.filter((p) => installedPluginIds.has(p.identifier));

  return list.map<InstallPluginMeta>((p) => ({
    author: p.author,
    createdAt: p.createdAt,
    homepage: p.homepage,
    identifier: p.identifier,
    meta: {
      avatar: p.avatar,
      description: p.description,
      tags: p.tags,
      title: p.title,
    },
    type: 'plugin',
  }));
};

const isPluginInstallLoading = (id: string) => (s: ToolStoreState) => s.pluginInstallLoading[id];

const getPluginInstallProgress = (id: string) => (s: ToolStoreState) => s.pluginInstallProgress[id];

const isOldPluginInInstallProgress = (id: string) => (s: ToolStoreState) =>
  !!s.pluginInstallProgress[id];

const getPluginById = (id: string) => (s: ToolStoreState) => {
  return s.oldPluginItems.find((i) => i.identifier === id);
};

export const pluginStoreSelectors = {
  getPluginById,
  getPluginInstallProgress,
  isOldPluginInInstallProgress,
  isPluginInstallLoading,
  onlinePluginStore,
};
