/**
 * Lobe Tools Executor
 *
 * Creates and exports the ToolsActivatorExecutor instance for registration.
 * Injects a stub service as dependency — actual tool manifest resolution
 * will be implemented in follow-up work when ToolDiscoveryProvider is ready.
 */
import {
  type ToolManifestInfo,
  ToolsActivatorExecutionRuntime,
  type ToolsActivatorRuntimeService,
} from '@lobechat/builtin-tool-tools/executionRuntime';
import { ToolsActivatorExecutor } from '@lobechat/builtin-tool-tools/executor';

// Stub service — will be replaced with real implementation
// when ToolDiscoveryProvider and state.tools mutations are ready
const stubService: ToolsActivatorRuntimeService = {
  getActivatedToolIds: () => [],
  getToolManifests: async (_identifiers: string[]): Promise<ToolManifestInfo[]> => {
    return [];
  },
  markActivated: () => {},
};

// Create runtime with stub service
const runtime = new ToolsActivatorExecutionRuntime({
  service: stubService,
});

// Create executor instance with the runtime
export const toolsActivatorExecutor = new ToolsActivatorExecutor(runtime);
