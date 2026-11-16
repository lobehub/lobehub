import { isConnectorLinkParam } from '@lobechat/mecha';
import isEqual from 'fast-deep-equal';

import { mcpAppAgentIdSelector } from '@/features/MCPApp/viewAgent';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

import { useConversationStore } from '../../../../store';

const NO_NAMES: Record<string, string> = {};

export interface ConnectorAccountScope {
  /** The tool's identifier: a connector tool's is its connector's. */
  identifier?: string;
  /** A message of the call, to find the agent that ran it. */
  messageId?: string;
}

/**
 * Account names for the account arguments of a tool call, keyed by argument.
 * Account ids are unique per connector only, so names come from the connector
 * this call runs on (as the call resolves it), never from another connector
 * that happens to hold the same id. An id that names no account there (another
 * workspace, a removed account, a value still streaming in) is left out, so
 * callers show it as it was sent.
 */
export const useConnectorAccountNames = (
  args: unknown,
  { identifier, messageId }: ConnectorAccountScope,
): Record<string, string> => {
  const agentId = useConversationStore(mcpAppAgentIdSelector(messageId));

  return useToolStore((s) => {
    if (!identifier || !args || typeof args !== 'object') return NO_NAMES;

    let names: Record<string, string> | undefined;
    // `link_id`, or `connector_link_id…` when a tool declares `link_id` itself.
    for (const [param, value] of Object.entries(args)) {
      if (typeof value !== 'string' || !isConnectorLinkParam(param)) continue;
      const name = connectorSelectors.connectorLinkNameForTool(identifier, value, agentId)(s);
      if (name) (names ??= {})[param] = name;
    }
    return names ?? NO_NAMES;
  }, isEqual);
};
