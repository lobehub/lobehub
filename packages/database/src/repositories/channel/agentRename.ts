import { agentDisplayName, CHANNEL_LIMITS } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { channelMembers, channels } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { normalizeInboxAgentTitle } from '../../utils/inboxAgent';

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
export const followAgentRename = async (
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
