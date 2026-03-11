/**
 * Lobe Tools Executor
 *
 * Creates and exports the ToolsActivatorExecutor instance for registration.
 * Resolves tool manifests from the tool store (installedPlugins + builtinTools).
 *
 * State tracking (getActivatedToolIds / markActivated) is intentionally a no-op
 * because the activated state is persisted in message pluginState and accumulated
 * by selectActivatedToolIdsFromMessages at each agentic loop step.
 */
import {
  type ToolManifestInfo,
  ToolsActivatorExecutionRuntime,
  type ToolsActivatorRuntimeService,
} from '@lobechat/builtin-tool-tools/executionRuntime';
import { ToolsActivatorExecutor } from '@lobechat/builtin-tool-tools/executor';

import { getToolStoreState } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors/tool';

const service: ToolsActivatorRuntimeService = {
  getActivatedToolIds: () => [],
  getToolManifests: async (identifiers: string[]): Promise<ToolManifestInfo[]> => {
    const s = getToolStoreState();

    // Only allow activation of tools that passed discovery filters
    // (discoverable, platform-available, not internal/hidden)
    const discoverable = new Set(
      toolSelectors.availableToolsForDiscovery(s).map((t) => t.identifier),
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
          avatar: builtin.manifest.meta?.avatar,
          identifier: builtin.identifier,
          name: builtin.manifest.meta?.title ?? builtin.identifier,
          systemRole: builtin.manifest.systemRole,
        });
        continue;
      }

      // Search installed plugins
      const plugin = s.installedPlugins.find((p) => p.identifier === id);
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
        });
      }
    }

    return results;
  },
  markActivated: () => {},
};

const runtime = new ToolsActivatorExecutionRuntime({ service });

export const toolsActivatorExecutor = new ToolsActivatorExecutor(runtime);
