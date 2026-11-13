import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

/**
 * The connector a conversation's call of `identifier` runs on: the row the
 * server's `callTool` resolves, looked up in this client's lists. A view's call
 * is approved against it and routed by its transport, so both follow the row
 * that executes.
 *
 * The client ranks its lists as the server does
 * (`connectorByIdentifierForAgent`) except for one thing only the server can
 * tell: whether this conversation may use the caller's private connectors — a
 * private agent's own direct topic, not a group, channel, share or another
 * agent's topic. When that decides between a private row and a shared one,
 * the server names the row (`connector.resolveForRun`). Without both an agent
 * and a topic the server never resolves a private row, so neither does this.
 *
 * Undefined when the server resolves no row, or one these lists don't hold.
 */
export const resolveRunConnector = async (
  identifier: string,
  { agentId, topicId }: { agentId?: string; topicId?: string } = {},
): Promise<ConnectorWithTools | undefined> => {
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
  if (own?.id === shared?.id) return shared;

  const { lambdaClient } = await import('@/libs/trpc/client');
  const resolved = await lambdaClient.connector.resolveForRun.query({
    agentId,
    identifier,
    topicId,
  });

  return [own, shared].find((connector) => !!connector && connector.id === resolved?.id);
};
