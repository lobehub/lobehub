import { agentDisplayName, CHANNEL_LIMITS } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

import { agents, channelMembers, channels } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { normalizeInboxAgentTitle } from '../../utils/inboxAgent';

/** PostgreSQL `deadlock_detected`: the victim's transaction was rolled back. */
const DEADLOCK_DETECTED = '40P01';
const RENAME_ATTEMPTS = 3;

/** The SQLSTATE of a driver error, which Drizzle may wrap in `cause`. */
const postgresErrorCode = (error: unknown): string | undefined => {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const code = (current as Record<string, unknown>).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
};

interface AgentLabelFields {
  name?: string | null;
  slug?: string | null;
  title?: string | null;
}

/** The label a Channel stores for an Agent when it opens a direct conversation or adds it. */
const channelAgentLabel = (agent: AgentLabelFields) =>
  agentDisplayName(
    { name: agent.name, title: normalizeInboxAgentTitle(agent.title, agent) },
    'Agent',
  );

/**
 * Carries an Agent's rename into the Channels that still show its old name. A direct
 * conversation's title and an Agent member's label are copied from the Agent when created, so
 * without this they keep the name it had then. Only copies that still equal the old name follow:
 * one a member renamed in the Channel stays as they set it.
 */
const followAgentRename = async (
  db: LobeChatDatabase | Transaction,
  agentId: string,
  before: AgentLabelFields,
  after: AgentLabelFields,
) => {
  const previous = channelAgentLabel(before);
  const next = channelAgentLabel(after);
  if (previous === next) return;

  const titleOf = (label: string) => label.slice(0, CHANNEL_LIMITS.titleLength);
  await db
    .update(channels)
    .set({ title: titleOf(next) })
    .where(and(eq(channels.agentId, agentId), eq(channels.title, titleOf(previous))));
  await db
    .update(channelMembers)
    .set({ name: next })
    .where(
      and(
        eq(channelMembers.agentId, agentId),
        eq(channelMembers.actorType, 'agent'),
        eq(channelMembers.name, previous),
      ),
    );
};

/**
 * Write an Agent's columns, `where` selecting its row in the caller's scope. A rename also
 * carries the new label into its Channels, under row locks: overlapping renames would otherwise
 * each read the same previous label, and the later one would match no copy, leaving them at the
 * earlier name for good.
 *
 * Channel writes lock the Channel before the Agent (adding a member holds the Agent `for share`
 * under the Channel lock), so a rename takes the Channels it touches first, in id order, and the
 * Agent last. Deleting the Agent locks it first and reaches its Channels through the cascade, so
 * no single order suits both; a rename that loses a deadlock reruns whole, re-reading the label,
 * and finds nothing to rename once the Agent is gone.
 */
export const writeAgent = async (
  db: LobeChatDatabase,
  where: SQL | undefined,
  agentId: string,
  data: AgentLabelFields & PgUpdateSetSource<typeof agents>,
) => {
  if (data.name === undefined && data.title === undefined)
    return db.update(agents).set(data).where(where);

  for (let attempt = 1; ; attempt++) {
    try {
      return await renameAgent(db, where, agentId, data);
    } catch (error) {
      if (postgresErrorCode(error) !== DEADLOCK_DETECTED || attempt === RENAME_ATTEMPTS)
        throw error;
    }
  }
};

const renameAgent = (
  db: LobeChatDatabase,
  where: SQL | undefined,
  agentId: string,
  data: AgentLabelFields & PgUpdateSetSource<typeof agents>,
) =>
  db.transaction(async (tx) => {
    const memberOf = tx
      .select({ id: channelMembers.channelId })
      .from(channelMembers)
      .where(and(eq(channelMembers.agentId, agentId), eq(channelMembers.actorType, 'agent')));
    await tx
      .select({ id: channels.id })
      .from(channels)
      .where(or(eq(channels.agentId, agentId), inArray(channels.id, memberOf)))
      .orderBy(asc(channels.id))
      .for('update');
    const [before] = await tx
      .select({ name: agents.name, slug: agents.slug, title: agents.title })
      .from(agents)
      .where(where)
      .for('update');
    const result = await tx.update(agents).set(data).where(where);
    if (before) await followAgentRename(tx, agentId, before, { ...before, ...data });
    return result;
  });
