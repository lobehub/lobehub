import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

import { connectorForTool } from './connectorForTool';

export const useMcpAppIdentity = (identifier: string, agentId?: string) =>
  useToolStore((s) => {
    const connector = connectorForTool(identifier, agentId)(s);
    const plugin = toolSelectors.getMetaById(identifier)(s);
    return [
      connector?.name || plugin?.title || identifier,
      plugin?.avatar || 'MCP_AVATAR',
    ] as const;
  });
