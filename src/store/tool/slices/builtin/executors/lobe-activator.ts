/**
 * Lobe Tools Executor
 *
 * Creates and exports the ActivatorExecutor instance for registration.
 * Resolves tool manifests from the tool store (installedPlugins + builtinTools +
 * lobehubSkillServers + composio servers + MCP connectors).
 *
 * State tracking (getActivatedToolIds / markActivated) is intentionally a no-op
 * because the activated state is persisted in message pluginState and accumulated
 * by selectActivatedToolIdsFromMessages at each agentic loop step.
 */
import {
  ActivatorExecutionRuntime,
  type ActivatorRuntimeService,
  type ToolManifestInfo,
} from '@lobechat/builtin-tool-activator/executionRuntime';
import { ActivatorExecutor } from '@lobechat/builtin-tool-activator/executor';
import { SkillsExecutionRuntime } from '@lobechat/builtin-tool-skills/executionRuntime';
import type { BuiltinToolContext } from '@lobechat/types';

import { agentSkillService } from '@/services/skill';
import { getToolStoreState } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { toolSelectors } from '@/store/tool/selectors/tool';
import { composioStoreSelectors } from '@/store/tool/slices/composioStore/selectors';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore';

import { clientSkillCatalog } from './clientSkillCatalog';

const createService = (discoverableIds?: string[]): ActivatorRuntimeService => ({
  getActivatedToolIds: () => [],
  getToolManifests: async (identifiers: string[], run): Promise<ToolManifestInfo[]> => {
    const s = getToolStoreState();

    // Only allow activation of tools that passed discovery filters
    // (discoverable, platform-available, not internal/hidden) for the
    // conversation the activation runs in
    const discoverable = new Set(
      discoverableIds ?? toolSelectors.availableToolsForDiscovery(s, run).map((t) => t.identifier),
    );
    const allowedIds = identifiers.filter((id) => discoverable.has(id));

    const results: ToolManifestInfo[] = [];

    for (const id of allowedIds) {
      // Search builtin tools
      const builtin = s.builtinTools.find((t) => t.identifier === id);
      if (builtin) {
        results.push({
          apiDescriptions: builtin.manifest.api.map((a) => ({
            description: a.description,
            name: a.name,
          })),
          avatar: builtin.avatar,
          identifier: builtin.identifier,
          name: builtin.title ?? builtin.identifier,
          systemRole: builtin.manifest.systemRole,
          // Passed through for wire-name matching: non-builtin types append
          // a `____<type>` segment to the offered wire name.
          type: builtin.manifest.type,
        });
        continue;
      }

      // Search installed plugins
      const plugin = pluginSelectors.getInstalledPluginById(id)(s);
      if (plugin?.manifest) {
        results.push({
          apiDescriptions: (plugin.manifest.api || []).map((a) => ({
            description: a.description,
            name: a.name,
          })),
          avatar: plugin.manifest.meta?.avatar,
          identifier: plugin.identifier,
          name: plugin.manifest.meta?.title ?? plugin.identifier,
          systemRole: plugin.manifest.systemRole,
          type: (plugin.manifest as { type?: string }).type,
        });
        continue;
      }

      // Search LobeHub Skill servers
      const lobehubSkillServer = s.lobehubSkillServers?.find(
        (server) => server.identifier === id && server.status === LobehubSkillStatus.CONNECTED,
      );
      if (lobehubSkillServer?.tools) {
        results.push({
          apiDescriptions: lobehubSkillServer.tools.map((t) => ({
            description: t.description || '',
            name: t.name,
          })),
          avatar: lobehubSkillServer.icon,
          identifier: lobehubSkillServer.identifier,
          name: lobehubSkillServer.name,
        });
        continue;
      }

      // Search Composio MCP servers — the discovery allowlist includes
      // connected Composio entries whose manifests come straight from the
      // cached `composioServers` replica, while `getInstalledPluginById`
      // only sees synced plugin replicas. During the startup window before
      // the independent plugin fetch lands, the plugin probe misses and
      // activation would fail with `Not found`; build the manifest from the
      // cached server tools instead. Placed after the LobeHub Skill probe to
      // mirror discovery's ownership rule: an identifier served by a
      // connected LobeHub Skill server must not be claimed by its legacy
      // Composio connection.
      const composioManifest = composioStoreSelectors
        .composioAsLobeTools(s)
        .find((tool) => tool.identifier === id);
      if (composioManifest) {
        results.push({
          apiDescriptions: (composioManifest.manifest.api || []).map((a: any) => ({
            description: a.description,
            name: a.name,
          })),
          avatar: composioManifest.manifest.meta?.avatar,
          identifier: composioManifest.identifier,
          name: composioManifest.manifest.meta?.title ?? composioManifest.identifier,
          systemRole: composioManifest.manifest.systemRole,
          type: (composioManifest.manifest as { type?: string }).type,
        });
        continue;
      }

      // MCP connectors no plugin row serves (every MCP install now), built the
      // way the tools engine offers them
      const connectorManifest = toolSelectors
        .executableConnectorManifests(s)
        .find((manifest) => manifest.identifier === id);
      if (connectorManifest) {
        results.push({
          apiDescriptions: connectorManifest.api.map((a) => ({
            description: a.description,
            name: a.name,
          })),
          avatar: connectorManifest.meta?.avatar,
          identifier: connectorManifest.identifier,
          name: connectorManifest.meta?.title ?? connectorManifest.identifier,
          type: connectorManifest.type,
        });
      }
    }

    return results;
  },
  // Full discoverable list, for inverting `MD5HASH_…` wire-name segments and
  // resolving bare API names: neither can be probed against the
  // identifier-keyed `getToolManifests`, so the runtime hashes every
  // discoverable identifier locally and matches the generated wire-name
  // variants. Reuses `getToolManifests` on the same
  // `availableToolsForDiscovery` allowlist so scoping and manifest mapping
  // cannot drift between the two paths.
  async listToolManifests(run): Promise<ToolManifestInfo[]> {
    const s = getToolStoreState();
    const discoveryIds =
      discoverableIds ??
      toolSelectors.availableToolsForDiscovery(s, run).map((tool) => tool.identifier);
    return this.getToolManifests(discoveryIds, run);
  },
  markActivated: () => {},
});

const runtime = (ctx: BuiltinToolContext) =>
  new ActivatorExecutionRuntime({
    service: {
      ...createService(ctx.stepContext?.discoverableToolIds),
      activateSkill: (args) => {
        const { builtinSkills, lookup } = clientSkillCatalog(ctx);
        return new SkillsExecutionRuntime({
          builtinSkills,
          service: {
            ...lookup,
            readResource: (id, path) => agentSkillService.readResource(id, path),
          },
        }).activateSkill(args);
      },
    },
  });

export const activatorExecutor = new ActivatorExecutor(runtime);
