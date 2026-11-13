import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

/** What routing a call and judging its approval read of the row it runs on. */
export type RunConnector = Pick<
  ConnectorWithTools,
  'id' | 'identifier' | 'isEnabled' | 'mcpConnectionType' | 'mcpServerUrl' | 'tools'
>;

/**
 * The connector a conversation's call of `identifier` runs on: the row the
 * server's `callTool` resolves. A view's call is approved against it and
 * routed by its transport, so both follow the row that executes.
 *
 * The client ranks its lists as the server does
 * (`connectorByIdentifierForAgent`) except for what only the server can tell:
 * whether this conversation may use the caller's own connections — a private
 * agent's own direct topic, not a group, channel, share or another agent's
 * topic. There the server may pick the caller's private row over a shared one,
 * or their personal connector (`workspace_id IS NULL`), which no workspace
 * list here holds. So in a workspace the server names the row
 * (`connector.resolveForRun`) and its answer carries the transport and tools
 * of a row these lists lack. Outside a workspace nothing is private or carried
 * over, so agreeing picks are the server's answer. Without both an agent and a
 * topic the server never resolves the caller's own rows, so neither does this.
 *
 * Undefined when the server resolves no row.
 */
export const resolveRunConnector = async (
  identifier: string,
  { agentId, topicId }: { agentId?: string; topicId?: string } = {},
): Promise<RunConnector | undefined> => {
  // Lazy, as in `mcpService`: the tool store imports the services that use this
  const [{ getToolStoreState }, { connectorSelectors }] = await Promise.all([
    import('@/store/tool/store'),
    import('@/store/tool/slices/connector/selectors'),
  ]);
  const s = getToolStoreState();
  const pick = (includePrivate: boolean) =>
    connectorSelectors.connectorByIdentifierForAgent(identifier, agentId, { includePrivate })(s);

  const shared = pick(false);
  if (!agentId || !topicId) return shared;

  const own = pick(true);
  if (own?.id === shared?.id && !getActiveWorkspaceId()) return shared;

  const { lambdaClient } = await import('@/libs/trpc/client');
  const resolved = await lambdaClient.connector.resolveForRun.query({
    agentId,
    identifier,
    topicId,
  });
  if (!resolved) return undefined;

  // The lists' copy when they hold the row, as the rest of the client shows it
  return (
    [own, shared].find((connector) => !!connector && connector.id === resolved.id) ??
    (resolved as RunConnector)
  );
};
