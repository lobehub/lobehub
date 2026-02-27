import { LobeToolIdentifier } from '@lobechat/builtin-tool-tools';
import {
  type ToolManifestInfo,
  ToolsActivatorExecutionRuntime,
  type ToolsActivatorRuntimeService,
} from '@lobechat/builtin-tool-tools/executionRuntime';

import { type ServerRuntimeRegistration } from './types';

/**
 * Tools Activator Server Runtime
 * Resolves tool manifests from context.toolManifestMap (populated by the agent state).
 */
export const toolsActivatorRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const activatedIds: string[] = [];

    const service: ToolsActivatorRuntimeService = {
      getActivatedToolIds: () => [...activatedIds],
      getToolManifests: async (identifiers: string[]): Promise<ToolManifestInfo[]> => {
        // Note: context.toolManifestMap should only contain discoverable tools.
        // The caller is responsible for scoping this map to exclude hidden/internal tools.
        const results: ToolManifestInfo[] = [];

        for (const id of identifiers) {
          const manifest = context.toolManifestMap[id];
          if (!manifest) continue;

          results.push({
            apiDescriptions: manifest.api.map((a) => ({
              description: a.description,
              name: a.name,
            })),
            identifier: manifest.identifier,
            name: manifest.meta?.title ?? manifest.identifier,
            systemRole: manifest.systemRole,
          });
        }

        return results;
      },
      markActivated: (identifiers: string[]) => {
        for (const id of identifiers) {
          if (!activatedIds.includes(id)) {
            activatedIds.push(id);
          }
        }
      },
    };

    return new ToolsActivatorExecutionRuntime({ service });
  },
  identifier: LobeToolIdentifier,
};
