import { useToolStore } from '@/store/tool';

export interface ConnectorDisplay {
  avatar?: string;
  identifier: string;
  name: string;
  sourceType?: string;
}

/**
 * How to show a connector the tool only knows by identifier: the name and
 * avatar from the connectors the client already loaded, falling back to what
 * the tool result said (`fallbackName`) and finally to the identifier, so a
 * card never renders blank for a connector this client has not fetched.
 */
export const useConnectorDisplay = (
  identifier: string | undefined,
  fallbackName?: string,
): ConnectorDisplay => {
  const connector = useToolStore((s) =>
    identifier
      ? ((s.connectors ?? []).find((c) => c.identifier === identifier) ??
        (s.agentBoundConnectors ?? []).find((c) => c.identifier === identifier))
      : undefined,
  );
  const avatar = connector?.metadata?.avatar;

  return {
    avatar: typeof avatar === 'string' ? avatar : undefined,
    identifier: identifier ?? '',
    name: connector?.name || fallbackName || identifier || '',
    sourceType: connector?.sourceType,
  };
};
