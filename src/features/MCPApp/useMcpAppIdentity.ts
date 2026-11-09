import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';

export const useMcpAppIdentity = (identifier: string, agentId?: string) =>
  useToolStore((s) => {
    const connector = connectorSelectors.connectorByIdentifierForAgent(identifier, agentId)(s);
    const plugin = toolSelectors.getMetaById(identifier)(s);
    return [
      connector?.name || plugin?.title || identifier,
      plugin?.avatar || 'MCP_AVATAR',
    ] as const;
  });
