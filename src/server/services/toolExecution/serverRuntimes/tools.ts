import { LobeToolIdentifier } from '@lobechat/builtin-tool-tools';
import {
  type ToolManifestInfo,
  ToolsActivatorExecutionRuntime,
  type ToolsActivatorRuntimeService,
} from '@lobechat/builtin-tool-tools/executionRuntime';

import { type ServerRuntimeRegistration } from './types';

/**
 * Tools Activator Server Runtime
 * Stub implementation — actual tool manifest resolution
 * will be implemented in follow-up work when ToolDiscoveryProvider is ready.
 */
export const toolsActivatorRuntime: ServerRuntimeRegistration = {
  factory: (_context) => {
    const activatedIds: string[] = [];

    const service: ToolsActivatorRuntimeService = {
      getActivatedToolIds: () => [...activatedIds],
      getToolManifests: async (_identifiers: string[]): Promise<ToolManifestInfo[]> => {
        // Stub: will be replaced with real tool manifest lookup
        return [];
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
