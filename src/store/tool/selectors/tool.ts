import {
  getKlavisServerByServerIdentifier,
  getLobehubSkillProviderById,
  isDesktop,
} from '@lobechat/const';
import { type RenderDisplayControl } from '@lobechat/types';
import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';

import { shouldEnableTool } from '@/helpers/toolFilters';
import { type MetaData } from '@/types/meta';
import { type LobeToolMeta } from '@/types/tool/tool';

import { type ToolStoreState } from '../initialState';
import { builtinToolSelectors } from '../slices/builtin/selectors';
import { KlavisServerStatus } from '../slices/klavisStore';
import { lobehubSkillStoreSelectors } from '../slices/lobehubSkillStore';
import { LobehubSkillStatus } from '../slices/lobehubSkillStore/types';
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

export interface AvailableToolForDiscovery {
  description: string;
  identifier: string;
  name: string;
}

/**
 * Get all tools available for tool discovery (activateTools).
 * Built from raw state to avoid inheriting unrelated filtering logic.
 *
 * Sources:
 * 1. Builtin tools (from s.builtinTools) — exclude non-discoverable, skills, platform-unavailable
 * 2. User-installed plugins (from s.installedPlugins) — exclude Klavis/LobeHub Skill/agent skill overlap
 * 3. Klavis MCP servers (connected) — description from KLAVIS_SERVER_TYPES
 * 4. LobeHub Skill servers (connected) — description from LOBEHUB_SKILL_PROVIDERS
 */
const availableToolsForDiscovery = (s: ToolStoreState): AvailableToolForDiscovery[] => {
  // Build exclusion sets for deduplication
  const builtinSkillIds = new Set((s.builtinSkills || []).map((skill) => skill.identifier));
  const agentSkillIds = new Set((s.agentSkills || []).map((skill) => skill.identifier));
  const klavisIds = new Set((s.servers || []).map((server) => server.identifier));
  const lobehubSkillIds = new Set((s.lobehubSkillServers || []).map((server) => server.identifier));

  // 1. Builtin tools — directly from s.builtinTools
  const builtinItems = s.builtinTools
    .filter((tool) => tool.discoverable !== false)
    .filter((tool) => !builtinSkillIds.has(tool.identifier))
    .filter((tool) => shouldEnableTool(tool.identifier)) // platform check (e.g., desktop-only)
    .map((tool) => ({
      description: tool.manifest.meta?.description || '',
      identifier: tool.identifier,
      name: tool.manifest.meta?.title || tool.identifier,
    }));

  // 2. User-installed plugins — directly from s.installedPlugins
  //    Exclude Klavis, LobeHub Skill, and agent skill entries (they are handled in dedicated sources)
  const pluginItems = s.installedPlugins
    .filter((p) => !klavisIds.has(p.identifier))
    .filter((p) => !lobehubSkillIds.has(p.identifier))
    .filter((p) => !agentSkillIds.has(p.identifier))
    .filter((p) => !p.customParams?.klavis) // extra safety for Klavis plugins
    .filter((p) => isDesktop || p.customParams?.mcp?.type !== 'stdio') // platform check
    .map((plugin) => {
      const meta = plugin.manifest?.meta;
      return {
        description: meta?.description || '',
        identifier: plugin.identifier,
        name: meta?.title || plugin.identifier,
      };
    });

  // 3. Klavis MCP servers (connected only)
  const klavisItems = (s.servers || [])
    .filter((server) => server.status === KlavisServerStatus.CONNECTED && server.tools?.length)
    .map((server) => {
      const config = getKlavisServerByServerIdentifier(server.identifier);
      return {
        description: config?.description || '',
        identifier: server.identifier,
        name: config?.label || server.serverName,
      };
    });

  // 4. LobeHub Skill servers (connected only)
  const lobehubSkillItems = (s.lobehubSkillServers || [])
    .filter((server) => server.status === LobehubSkillStatus.CONNECTED)
    .map((server) => {
      const config = getLobehubSkillProviderById(server.identifier);
      return {
        description: config?.description || '',
        identifier: server.identifier,
        name: config?.label || server.name,
      };
    });

  return [...builtinItems, ...pluginItems, ...klavisItems, ...lobehubSkillItems];
};

export const toolSelectors = {
  availableToolsForDiscovery,
  getManifestById,
  getManifestLoadingStatus,
  getMetaById,
  getRenderDisplayControl,
  isToolHasUI,
  metaList,
};
