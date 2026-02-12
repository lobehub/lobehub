import { type RenderDisplayControl } from '@lobechat/types';
import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';

import { type MetaData } from '@/types/meta';
import { type LobeToolMeta } from '@/types/tool/tool';

import { type ToolStoreState } from '../initialState';
import { builtinToolSelectors } from '../slices/builtin/selectors';
import { lobehubSkillStoreSelectors } from '../slices/lobehubSkillStore/selectors';
import { pluginSelectors } from '../slices/plugin/selectors';

const metaList = (s: ToolStoreState): LobeToolMeta[] => {
  const pluginList = pluginSelectors.installedPluginMetaList(s) as LobeToolMeta[];
  const lobehubSkillList = lobehubSkillStoreSelectors.metaList(s) as LobeToolMeta[];

  return builtinToolSelectors.metaList(s).concat(pluginList).concat(lobehubSkillList);
};

const getMetaById =
  (id: string) =>
  (s: ToolStoreState): MetaData | undefined => {
    const item = metaList(s).find((m) => m.identifier === id);

    if (!item) return;

    if (item.meta) return item.meta;

    return {
      avatar: item?.avatar,
      backgroundColor: item?.backgroundColor,
      description: item?.description,
      title: item?.title,
    };
  };

const getManifestById =
  (id: string) =>
  (s: ToolStoreState): LobeChatPluginManifest | undefined =>
    pluginSelectors
      .installedPluginManifestList(s)
      .concat(s.builtinTools.map((b) => b.manifest as LobeChatPluginManifest))
      .find((i) => i.identifier === id);

// Get plugin manifest loading status
const getManifestLoadingStatus = (id: string) => (s: ToolStoreState) => {
  const manifest = getManifestById(id)(s);

  if (s.pluginInstallLoading[id]) return 'loading';

  if (!manifest) return 'error';

  if (!!manifest) return 'success';
};

const isToolHasUI = (id: string) => (s: ToolStoreState) => {
  const manifest = getManifestById(id)(s);
  if (!manifest) return false;
  const builtinTool = s.builtinTools.find((tool) => tool.identifier === id);

  if (builtinTool && builtinTool.type === 'builtin') {
    return true;
  }

  return !!manifest.ui;
};

/**
 * Get the renderDisplayControl configuration for a specific tool API
 * Only works for builtin tools, plugins don't support this feature yet
 * @param identifier - Tool identifier
 * @param apiName - API name
 * @returns RenderDisplayControl value, defaults to 'collapsed'
 */
const getRenderDisplayControl =
  (identifier: string, apiName: string) =>
  (s: ToolStoreState): RenderDisplayControl => {
    // Only builtin tools support renderDisplayControl
    const builtinTool = s.builtinTools.find((t) => t.identifier === identifier);
    if (!builtinTool) return 'collapsed';

    const api = builtinTool.manifest.api.find((a) => a.name === apiName);
    return api?.renderDisplayControl ?? 'collapsed';
  };

export const toolSelectors = {
  getManifestById,
  getManifestLoadingStatus,
  getMetaById,
  getRenderDisplayControl,
  isToolHasUI,
  metaList,
};
