import { type Meta, type ToolManifest } from '@lobechat/types';

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

/**
 * Marketplace `PluginManifest` shape (`@lobehub/market-types`): flat
 * `name` / `description` / `icon` and no `meta` object. The server-side agent
 * builder install path stores this shape verbatim in `user_installed_plugins`,
 * so a community MCP row can reach the client without `manifest.meta`.
 */
interface MarketShapedManifest {
  description?: string;
  icon?: string;
  meta?: Meta;
  name?: string;
  tags?: string[];
}

/**
 * Resolve the display meta of an installed plugin manifest.
 *
 * Prefers the LobeChat `manifest.meta`; when it is absent, derive it from the
 * marketplace shape so the row still renders its real name instead of a blank
 * label.
 */
export const resolvePluginManifestMeta = (manifest?: ToolManifest | null): Meta | undefined => {
  if (!manifest) return;
  if (manifest.meta) return manifest.meta;

  const { description, icon, name, tags } = manifest as MarketShapedManifest;
  // `Meta.title` is required; without a market `name` there is nothing to
  // derive and consumers fall back to the identifier.
  if (!name) return;

  return {
    avatar: icon,
    description,
    tags,
    title: name,
  };
};

const getPluginMetaById = (id: string) => (s: ToolStoreState) => {
  return resolvePluginManifestMeta(getInstalledPluginById(id)(s)?.manifest);
};

const getCustomPluginById = (id: string) => (s: ToolStoreState) =>
  installedPlugins(s).find((i) => i.identifier === id && i.type === 'customPlugin') as
    LobeToolCustomPlugin | undefined;

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
    // Filter out Composio plugins (they have their own display location)
    .filter((p) => !p.customParams?.composio)
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
