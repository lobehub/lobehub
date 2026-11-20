import { toolSelectors } from '@/store/tool/selectors';
import type { ToolStore } from '@/store/tool/store';

import { connectorForTool } from './connectorForTool';

/**
 * The name an MCP App goes by in the conversation: its plugin's title, else the
 * connector's name (the agent's own connector first), else the identifier once
 * the plugin or connector is gone.
 */
export const mcpAppNameSelector =
  (identifier: string, agentId?: string) =>
  (s: ToolStore): string =>
    toolSelectors.getMetaById(identifier)(s)?.title ||
    connectorForTool(identifier, agentId)(s)?.name ||
    identifier;
