import type { InboundWebhookItem } from '@lobechat/types';
import { and, inArray } from 'drizzle-orm';

import type { InboundWebhookView } from '@/database/models/inboundWebhook';
import { agents, topics, userConnectors } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { normalizeInboxAgentMeta } from '@/database/utils/inboxAgent';
import { buildWorkspaceWhere } from '@/database/utils/workspace';

import { getInboundWebhookKind } from './kinds';

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
  /** Full call URLs of the generic rows `actor` may manage, keyed by webhook id. */
  endpoints: ReadonlyMap<string, string> = new Map(),
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
        and(
          inArray(
            agents.id,
            rows.map((r) => r.agentId),
          ),
          // The list is workspace-wide, but an agent is not: a private agent stays hidden from
          // the other members, as it does on every agent read path.
          buildWorkspaceWhere(
            { userId: actor.userId, workspaceId: actor.workspaceId ?? undefined },
            {
              isDeleted: agents.isDeleted,
              userId: agents.userId,
              visibility: agents.visibility,
              workspaceId: agents.workspaceId,
            },
          ),
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
    .filter((r) => ['active', 'error', 'terminated', 'paused'].includes(r.status))
    .flatMap((row): InboundWebhookItem[] => {
      const kind = getInboundWebhookKind(row.kind);
      if (!kind) return [];
      const agentRow = agentRows.find((a) => a.id === row.agentId);
      // Without the agent, its Topic, the connector it owns and its task are its details too.
      const connector = connectorRows.find(
        (c) => c.id === row.connectorId && (agentRow || !c.agentId),
      );
      const canManage = canManageInboundWebhook(actor, row);
      return [
        {
          agent: agentRow ? toAgentItem(agentRow) : null,
          canCheck: kind.canCheck,
          canManage,
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
          // The call URL and the task it runs act on the agent, so they go with its visibility.
          endpoint: canManage && agentRow ? (endpoints.get(row.id) ?? null) : null,
          expiresAt: kind.expiresAt?.(row) ?? null,
          id: row.id,
          instructions: agentRow ? row.instructions : null,
          kind: row.kind,
          lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
          lastError: row.lastError,
          name: row.name,
          source: kind.source(row),
          status: row.status as InboundWebhookItem['status'],
          topic: (agentRow && topicRows.find((t) => t.id === row.topicId)) || null,
        },
      ];
    });
}
