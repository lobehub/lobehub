import type { SQL } from 'drizzle-orm';
import { and, eq, sql } from 'drizzle-orm';

import type { ConnectorMetadata } from '../schemas';
import { userConnectors } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { withoutEvalConnectorMarker } from './connectorEval';

/** The {@link ConnectorModel}'s row filter: its user, workspace and access scope. */
type ConnectorOwnership = () => SQL | undefined;

const metadataContains = (match: Record<string, unknown>) =>
  sql`${userConnectors.metadata} @> ${JSON.stringify(match)}::jsonb`;

/**
 * Delete the row, with its tools, only while its metadata still contains
 * `match`: a writer that tagged the row removes it only if no one has
 * rewritten it since (a re-add replaces the metadata). Returns whether it did.
 */
export const deleteIfMetadataContains = async (
  db: LobeChatDatabase,
  ownership: ConnectorOwnership,
  id: string,
  match: Record<string, unknown>,
): Promise<boolean> => {
  const deleted = await db
    .delete(userConnectors)
    .where(and(eq(userConnectors.id, id), ownership(), metadataContains(match)))
    .returning({ id: userConnectors.id });
  return deleted.length > 0;
};

/**
 * Replace the row's metadata only while it still contains `match`, as
 * {@link deleteIfMetadataContains} deletes: a writer that tagged the row
 * finishes it only if no one has re-added it since, whose writer owns it now.
 * An evaluation connection is left alone (its provenance goes through
 * {@link ConnectorModel.update}). In a transaction, a write that lands holds
 * the row's lock until it ends, so the writer's other writes to the row land
 * with it, before any {@link ConnectorModel.update}. Returns whether it did.
 */
export const updateMetadataIfContains = async (
  db: LobeChatDatabase,
  ownership: ConnectorOwnership,
  id: string,
  match: Record<string, unknown>,
  metadata: ConnectorMetadata,
): Promise<boolean> => {
  const updated = await db
    .update(userConnectors)
    .set({ metadata: withoutEvalConnectorMarker(metadata), updatedAt: new Date() })
    .where(
      and(
        eq(userConnectors.id, id),
        ownership(),
        metadataContains(match),
        sql`NOT COALESCE(jsonb_exists(${userConnectors.metadata}, 'agentEval'), false)`,
      ),
    )
    .returning({ id: userConnectors.id });
  return updated.length > 0;
};
