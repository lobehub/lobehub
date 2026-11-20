import { getBuiltinRenderDisplayControl } from '@lobechat/builtin-tools/displayControls';
import {
  getComposioAppByIdentifier,
  getLobehubSkillProviderById,
  isDesktop,
} from '@lobechat/const';
import {
  manifestBaseIdentifier,
  type RenderDisplayControl,
  type ToolManifest,
} from '@lobechat/types';

import {
  isInstalledPluginAvailableInCurrentEnv,
  isToolAvailableInCurrentEnv,
} from '@/helpers/toolAvailability';
import { buildClientConnectorManifests } from '@/helpers/toolEngineering/buildClientConnectorManifests';
import {
  getAllRunConnectors,
  getRunConnectors,
  type RunConnectorsTarget,
} from '@/services/runConnectors';
import { type MetaData } from '@/types/meta';
import { type LobeToolMeta } from '@/types/tool/tool';

import { type ToolStoreState } from '../initialState';
import { agentSkillsSelectors } from '../slices/agentSkills/selectors';
import { builtinToolSelectors } from '../slices/builtin/selectors';
import { ComposioServerStatus } from '../slices/composioStore';
import { composioIdsOutsideRun, connectorSelectors } from '../slices/connector/selectors';
import { lobehubSkillStoreSelectors } from '../slices/lobehubSkillStore';
import { LobehubSkillStatus } from '../slices/lobehubSkillStore/types';
import { pluginSelectors } from '../slices/plugin/selectors';

const metaList = (s: ToolStoreState): LobeToolMeta[] => {
  const pluginList = pluginSelectors.installedPluginMetaList(s) as LobeToolMeta[];
  const lobehubSkillList = lobehubSkillStoreSelectors.metaList(s) as LobeToolMeta[];

  return builtinToolSelectors.metaList(s).concat(pluginList).concat(lobehubSkillList);
};

/**
 * All installed discoverable tools across every source (builtins, plugins, skills).
 * Excludes only tools with `discoverable: false` (pure infrastructure / internal).
 * Includes hidden and runtime-managed builtins (web-browsing, memory, cloud-sandbox, etc.)
 * that `metaList` hides from the chat toolbar.
 */
const discoverableMetaList = (s: ToolStoreState): LobeToolMeta[] => {
  const pluginList = pluginSelectors.installedPluginMetaList(s) as LobeToolMeta[];
  const lobehubSkillList = lobehubSkillStoreSelectors.metaList(s) as LobeToolMeta[];

  return builtinToolSelectors.discoverableMetaList(s).concat(pluginList).concat(lobehubSkillList);
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

/**
 * The MCP connectors chat can run, as the tools engine offers them: custom
 * ones and finished marketplace installs (every MCP install lands here now),
 * one manifest per row under its tool prefix. Rows the server listed for a
 * conversation (`connector.listForRun`, a private agent's owner's personal
 * connectors among them) join the local ones, so a call naming any row's
 * prefix resolves.
 */
const executableConnectorManifests = (s: ToolStoreState): ToolManifest[] => {
  const local = connectorSelectors.executableMcpConnectors(s);
  const known = new Set(local.map((c) => c.id));
  const listed = connectorSelectors.executableMcpConnectors({
    connectors: getAllRunConnectors().filter((c) => !known.has(c.id) && !!known.add(c.id)),
    installedPlugins: s.installedPlugins,
  });
  return buildClientConnectorManifests([...local, ...listed]);
};

/**
 * A connector-only identifier is read from its connector; one that still has
 * a plugin row is read from the plugin, as before.
 */
const getManifestById =
  (id: string) =>
  (s: ToolStoreState): ToolManifest | undefined =>
    pluginSelectors
      .installedPluginManifestList(s)
      .concat(s.builtinTools.map((b) => b.manifest as ToolManifest))
      .find((i) => i.identifier === id) ??
    executableConnectorManifests(s).find((i) => i.identifier === id);

// Get plugin manifest loading status
const getManifestLoadingStatus = (id: string) => (s: ToolStoreState) => {
  const manifest = getManifestById(id)(s);

  if (s.pluginInstallLoading[id]) return 'loading';

  if (s.pluginInstallErrors[id]) return 'error';

  if (!manifest) return 'error';

  if (!!manifest) return 'success';
};

const getPluginInstallError = (id: string) => (s: ToolStoreState) => s.pluginInstallErrors[id];

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
 * @param pluginState - The tool_result's plugin state, for APIs whose display
 *   control depends on what the result carries (e.g. CC `Read` renders a
 *   thumbnail for an image and source text for anything else). Undefined while
 *   the call is still in flight.
 * @returns RenderDisplayControl value, defaults to 'collapsed'
 */
const getRenderDisplayControl =
  (identifier: string, apiName: string, pluginState?: unknown) =>
  (s: ToolStoreState): RenderDisplayControl => {
    const builtinTool = s.builtinTools.find((t) => t.identifier === identifier);
    const manifestControl = builtinTool?.manifest.api.find(
      (a) => a.name === apiName,
    )?.renderDisplayControl;
    if (manifestControl) return manifestControl;

    // Fallback for packages that don't ship a LobeChat manifest (e.g. Claude Code —
    // its tools come from Anthropic tool_use blocks at runtime).
    return getBuiltinRenderDisplayControl(identifier, apiName, pluginState) ?? 'collapsed';
  };

export interface AvailableToolForDiscovery {
  /**
   * The connector a connector row's tool set serves, when it is named apart
   * from it (a private or personal row): agent switches speak this identifier.
   */
  connectorIdentifier?: string;
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
 * 2. User-installed plugins (from s.installedPlugins) — exclude Composio/LobeHub Skill/agent skill overlap
 * 3. Composio MCP servers (connected) — description from COMPOSIO_APP_TYPES
 * 4. LobeHub Skill servers (connected) — description from LOBEHUB_SKILL_PROVIDERS
 * 5. MCP connectors chat can run (custom, finished marketplace installs) that no
 *    entry above already lists — stdio ones only on desktop
 */
const availableToolsForDiscovery = (
  s: ToolStoreState,
  /**
   * The conversation the run belongs to: its connector rows are the ones the
   * server listed for it (`connector.listForRun`). Without that listing only
   * the caller's shared rows are discoverable — whether a conversation may run
   * a private or personal row is the server's call, so none is offered on a
   * guess.
   */
  run: RunConnectorsTarget = {},
): AvailableToolForDiscovery[] => {
  // Build exclusion sets for deduplication
  const builtinSkillIds = new Set((s.builtinSkills || []).map((skill) => skill.identifier));
  const agentSkillIds = new Set(
    agentSkillsSelectors.getAgentSkills(s).map((skill) => skill.identifier),
  );
  const composioIds = new Set((s.composioServers || []).map((server) => server.identifier));
  const lobehubSkillIds = new Set((s.lobehubSkillServers || []).map((server) => server.identifier));

  // 1. Builtin tools — directly from s.builtinTools
  const builtinItems = s.builtinTools
    .filter((tool) => tool.discoverable !== false)
    .filter((tool) => !builtinSkillIds.has(tool.identifier))
    .filter((tool) => isToolAvailableInCurrentEnv(tool.identifier))
    .map((tool) => ({
      description: tool.description || '',
      identifier: tool.identifier,
      name: tool.title || tool.identifier,
    }));

  // 2. User-installed plugins — only full records: a plugin painted from the
  //    cached display projection has no connection yet, so it cannot be activated.
  //    Exclude Composio, LobeHub Skill, and agent skill entries (they are handled in dedicated sources)
  const pluginItems = pluginSelectors
    .confirmedInstalledPlugins(s)
    .filter((p) => !composioIds.has(p.identifier))
    .filter((p) => !lobehubSkillIds.has(p.identifier))
    .filter((p) => !agentSkillIds.has(p.identifier))
    .filter((p) => !p.customParams?.composio) // extra safety for Composio plugins
    .filter((plugin) => isInstalledPluginAvailableInCurrentEnv(plugin))
    .map((plugin) => {
      const meta = plugin.manifest?.meta;
      return {
        description: meta?.description || '',
        identifier: plugin.identifier,
        name: meta?.title || plugin.identifier,
      };
    });

  // 3. Composio MCP servers (connected only), but none whose only connections
  //    the conversation may not use: without its listing, shared ones only
  const composioOutsideRun = composioIdsOutsideRun(s.connectors ?? [], {
    agentId: run.agentId,
    includePrivate: false,
    listed: run.agentId ? getRunConnectors(run) : undefined,
  });
  const composioItems = (s.composioServers || [])
    .filter((server) => server.status === ComposioServerStatus.ACTIVE && server.tools?.length)
    .filter((server) => !composioOutsideRun.has(server.identifier))
    // A connector identifier can have legacy Composio and current LobeHub
    // connections at the same time. Tool discovery is identifier-based, so the
    // canonical LobeHub connection must own the single visible entry.
    .filter(
      (server) =>
        !s.lobehubSkillServers?.some(
          (item) =>
            item.identifier === server.identifier && item.status === LobehubSkillStatus.CONNECTED,
        ),
    )
    .map((server) => {
      const config = getComposioAppByIdentifier(server.identifier);
      return {
        description: config?.description || '',
        identifier: server.identifier,
        name: config?.label || server.label,
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

  // 5. MCP connectors, as the tools engine offers them: a connector's tool sets
  //    replace a same-identifier plugin row (`assembleManifestPool`), so the
  //    plugin's bare entry gives way to them. Stdio servers run only on a desktop.
  const builtinIds = new Set(builtinItems.map((item) => item.identifier));
  //    Each row is its own tool set (a private or personal row under its own
  //    prefix), so a manifest is runnable by the row it was built from, and
  //    deduplicated against the other sources by the connector it serves.
  const listedForRun = run.agentId ? getRunConnectors(run) : undefined;
  const runRows = listedForRun
    ? connectorSelectors.executableMcpConnectors({
        connectors: listedForRun,
        installedPlugins: s.installedPlugins,
      })
    : connectorSelectors
        .executableMcpConnectors(s)
        .filter((connector) => connector.visibility !== 'private');
  const runnableHere = new Set(
    runRows
      .filter((connector) => isDesktop || connector.mcpConnectionType !== 'stdio')
      .map((connector) => connector.id),
  );
  const connectorManifests = executableConnectorManifests(s)
    .filter((manifest) => !!manifest.connector && runnableHere.has(manifest.connector.id))
    .filter((manifest) => !builtinIds.has(manifestBaseIdentifier(manifest)));
  const connectorBaseIds = new Set(connectorManifests.map(manifestBaseIdentifier));
  const connectorItems = connectorManifests
    .filter((manifest) => !composioIds.has(manifestBaseIdentifier(manifest)))
    .filter((manifest) => !lobehubSkillIds.has(manifestBaseIdentifier(manifest)))
    .map((manifest) => ({
      ...(manifestBaseIdentifier(manifest) !== manifest.identifier && {
        connectorIdentifier: manifestBaseIdentifier(manifest),
      }),
      description: manifest.meta?.description || '',
      identifier: manifest.identifier,
      name: manifest.meta?.title || manifest.identifier,
    }));

  return [
    ...builtinItems,
    ...pluginItems.filter((item) => !connectorBaseIds.has(item.identifier)),
    ...composioItems,
    ...lobehubSkillItems,
    ...connectorItems,
  ];
};

export const toolSelectors = {
  availableToolsForDiscovery,
  discoverableMetaList,
  executableConnectorManifests,
  getManifestById,
  getManifestLoadingStatus,
  getPluginInstallError,
  getMetaById,
  getRenderDisplayControl,
  isToolHasUI,
  metaList,
};
