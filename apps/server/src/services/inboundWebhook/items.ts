import type { InboundWebhookItem } from '@lobechat/types';
import { inArray } from 'drizzle-orm';

import type { InboundWebhookView } from '@/database/models/inboundWebhook';
import { agents, topics, userConnectors } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { normalizeInboxAgentMeta } from '@/database/utils/inboxAgent';

export interface InboundWebhookActor {
  userId: string;
  workspaceId?: string | null;
  workspaceRole?: string;
}
export const canManageInboundWebhook = (actor: InboundWebhookActor, row: InboundWebhookView) =>
  row.userId === actor.userId ||
  (!!actor.workspaceId &&
    row.workspaceId === actor.workspaceId &&
    ['owner', 'admin'].includes(actor.workspaceRole ?? ''));

/** Select public projections only; credentials and opaque runtime state never cross this boundary. */
export async function inboundWebhookItems(
  db: LobeChatDatabase,
  rows: InboundWebhookView[],
  actor: InboundWebhookActor,
): Promise<InboundWebhookItem[]> {
  if (!rows.length) return [];
  const [connectorRows, agentRows, topicRows] = await Promise.all([
    db
      .select({
        agentId: userConnectors.agentId,
        id: userConnectors.id,
        identifier: userConnectors.identifier,
        metadata: userConnectors.metadata,
        name: userConnectors.name,
      })
      .from(userConnectors)
      .where(
        inArray(
          userConnectors.id,
          rows.flatMap((r) => (r.connectorId ? [r.connectorId] : [])),
        ),
      ),
    db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        id: agents.id,
        slug: agents.slug,
        title: agents.title,
      })
      .from(agents)
      .where(
        inArray(
          agents.id,
          rows.map((r) => r.agentId),
        ),
      ),
    db
      .select({ id: topics.id, title: topics.title })
      .from(topics)
      .where(
        inArray(
          topics.id,
          rows.flatMap((r) => (r.topicId ? [r.topicId] : [])),
        ),
      ),
  ]);
  // The default agent is stored without a title or avatar. Resolve it the way
  // every other agent read path does, so the list shows the same name and
  // avatar as the sidebar; the slug only serves that lookup.
  const toAgentItem = ({ slug, ...agent }: (typeof agentRows)[number]) =>
    normalizeInboxAgentMeta(agent, { slug });

  return rows
    .filter((r) => ['active', 'error', 'terminated'].includes(r.status))
    .map((row) => {
      const connector = connectorRows.find((c) => c.id === row.connectorId);
      const agentRow = agentRows.find((a) => a.id === row.agentId);
      return {
        agent: agentRow ? toAgentItem(agentRow) : null,
        canCheck: row.kind === 'mcp_events',
        canManage: canManageInboundWebhook(actor, row),
        connector: connector
          ? {
              agentId: connector.agentId,
              avatar: connector.metadata?.avatar ?? null,
              id: connector.id,
              identifier: connector.identifier,
              name: connector.name,
            }
          : null,
        createdAt: row.createdAt.toISOString(),
        creatorId: row.userId,
        expiresAt: row.state.refreshBefore ?? null,
        id: row.id,
        kind: row.kind,
        lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
        lastError: row.lastError,
        name: row.name,
        source: {
          arguments: row.config.arguments,
          eventName: row.config.eventName,
          kind: row.kind,
        },
        status: row.status as InboundWebhookItem['status'],
        topic: topicRows.find((t) => t.id === row.topicId) ?? null,
      };
    });
}
