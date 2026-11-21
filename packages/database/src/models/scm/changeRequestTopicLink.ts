import type { ScmChangeRequestMetadata } from '@lobechat/types';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { scmChangeRequests } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/**
 * The conversation a topic's own PR link (branch match or Link a PR) made
 * Auto-fix wake, kept on the change request row as `metadata.topicLink`. The
 * link only fills an empty slot, and gives way to every source the provider
 * events resolve (acceptance, Work). While it holds the slot, removing the
 * PR from the topic clears it again.
 */
type TopicLink = ScmChangeRequestMetadata['topicLink'];

/** The slot holds the conversation `topicId`'s link wrote, at whatever generation. */
const heldByLinkOf = (topicId: string) =>
  and(
    eq(scmChangeRequests.topicId, topicId),
    sql`${scmChangeRequests.metadata} -> 'topicLink' ->> 'topicId' = ${topicId}`,
  );

/**
 * What a provider event leaves of the marker. It stays only while the row
 * still wakes the linking topic and the event did not resolve that same
 * conversation itself. Once a resolver source backs it (even a stale
 * delivery finding the topic's Work), or the conversation changed under it,
 * the binding is no longer the link's, and removing the PR from that topic
 * must not clear it.
 */
export const topicLinkAfterEvent = (
  held: TopicLink,
  resolvedTopicId: string | null | undefined,
  topicId: string | null,
): TopicLink =>
  held && topicId === held.topicId && resolvedTopicId !== topicId ? held : undefined;

/**
 * SET values for the conversation a Work registration names. It fills an
 * empty slot and takes over one that only a topic link holds, dropping the
 * marker, which is where the next provider event would land as well. A
 * conversation an acceptance or another Work set stays. Both values are
 * computed from the row as it was before the UPDATE.
 */
export const workTopicValues = (topicId: string) => {
  const takes = sql`(${scmChangeRequests.topicId} IS NULL OR ${scmChangeRequests.metadata} -> 'topicLink' ->> 'topicId' = ${scmChangeRequests.topicId})`;
  return {
    metadata: sql`CASE WHEN ${takes} THEN ${scmChangeRequests.metadata} - 'topicLink' ELSE ${scmChangeRequests.metadata} END`,
    topicId: sql`CASE WHEN ${takes} THEN ${topicId}::text ELSE ${scmChangeRequests.topicId} END`,
  };
};

/**
 * Make `topicId` the conversation a topic link wakes: the topic kept this
 * pull request on its own list, and the row is the linking person's own in
 * the scope they linked from. Fill-only: a conversation already set by an
 * acceptance, a Work, or another topic's link is never replaced. A slot this
 * topic's own link already holds is claimed again. Every condition rides
 * inside the UPDATE, so a concurrent ingest that fills or re-routes the row
 * wins.
 *
 * Each claim stamps a fresh generation (`topicLink.claimId`) and returns it,
 * `null` when the slot was not this link's to take. A release is fenced by
 * the generation its caller observed (see {@link releaseTopicFromLink}), so
 * a release decided before a relink cannot undo the relink's claim: the
 * relink restamps the slot first.
 */
export const claimTopicFromLink = async (
  db: LobeChatDatabase,
  id: string,
  scope: { userId: string; workspaceId?: string | null },
  topicId: string,
): Promise<string | null> => {
  const claimId = crypto.randomUUID();
  const marker = sql`${JSON.stringify({
    topicLink: { at: new Date().toISOString(), claimId, topicId },
  })}::jsonb`;
  const [row] = await db
    .update(scmChangeRequests)
    .set({
      metadata: sql`${scmChangeRequests.metadata} || ${marker}`,
      topicId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scmChangeRequests.id, id),
        or(isNull(scmChangeRequests.topicId), heldByLinkOf(topicId)),
        eq(scmChangeRequests.userId, scope.userId),
        scope.workspaceId
          ? eq(scmChangeRequests.workspaceId, scope.workspaceId)
          : isNull(scmChangeRequests.workspaceId),
      ),
    )
    .returning({ id: scmChangeRequests.id });
  return row ? claimId : null;
};

/**
 * Undo {@link claimTopicFromLink}: clear the conversation, but only while it
 * is still the one `topicId`'s link wrote, at the generation `claimId` the
 * caller observed. A conversation a resolver source backs since (the marker
 * is dropped then) or a newer claim of the same link is left alone. `true`
 * when the row was released.
 */
export const releaseTopicFromLink = async (
  db: LobeChatDatabase,
  id: string,
  topicId: string,
  claimId: string,
): Promise<boolean> => {
  const rows = await db
    .update(scmChangeRequests)
    .set({
      metadata: sql`${scmChangeRequests.metadata} - 'topicLink'`,
      topicId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scmChangeRequests.id, id),
        heldByLinkOf(topicId),
        sql`${scmChangeRequests.metadata} -> 'topicLink' ->> 'claimId' = ${claimId}`,
      ),
    )
    .returning({ id: scmChangeRequests.id });
  return rows.length > 0;
};
