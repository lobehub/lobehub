import type { ContactAgentProfile, ContactCard } from '@lobechat/types';
import { agentDisplayName } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { agents, agentShares, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { normalizeInboxAgentAvatar, normalizeInboxAgentTitle } from '../utils/inboxAgent';
import { notTrashed } from '../utils/softDelete';

/** An Agent's owner, joined next to `agents` when an Agent is read through its share. */
export const owners = alias(users, 'contact_agent_owner');

/** Columns of an Agent reached through its share, with the owner joined as `owners`. */
export const agentProfileColumns = {
  agentAvatar: agents.avatar,
  agentBackgroundColor: agents.backgroundColor,
  agentDescription: agents.description,
  agentId: agents.id,
  agentName: agents.name,
  agentSlug: agents.slug,
  agentTitle: agents.title,
  isDeleted: agents.isDeleted,
  ownerAvatar: owners.avatar,
  ownerFullName: owners.fullName,
  ownerId: owners.id,
  ownerUsername: owners.username,
  shareId: agentShares.id,
  shareSlug: sql<string | null>`${agentShares.shareConfig} ->> 'slug'`,
  visibility: agentShares.visibility,
};

type AgentProfileRow = {
  agentAvatar: string | null;
  agentBackgroundColor: string | null;
  agentDescription: string | null;
  agentId: string;
  agentName: string | null;
  agentSlug: string | null;
  agentTitle: string | null;
  ownerAvatar: string | null;
  ownerFullName: string | null;
  ownerId: string | null;
  ownerUsername: string | null;
  shareId: string;
  shareSlug: string | null;
};

export const toAgentProfile = (row: AgentProfileRow): ContactAgentProfile => ({
  agentId: row.agentId,
  avatar: normalizeInboxAgentAvatar(row.agentAvatar, { slug: row.agentSlug }) ?? null,
  backgroundColor: row.agentBackgroundColor,
  description: row.agentDescription,
  name: row.agentName?.trim() || null,
  owner: {
    avatar: row.ownerAvatar,
    fullName: row.ownerFullName,
    id: row.ownerId ?? '',
    username: row.ownerUsername,
  },
  shareId: row.shareId,
  slug: row.shareSlug,
  title: normalizeInboxAgentTitle(row.agentTitle, { slug: row.agentSlug }) ?? null,
});

/**
 * An Agent card the caller may send, with its snapshot. A public Agent of the caller's workspace
 * shared inside it needs no share: every member reaches it there already. Otherwise its owner may
 * share it while its share is `card` or `link`, and anyone may pass on a `link` share; an owner
 * whose share is off is told to turn card sharing on, never refused outright.
 */
export const resolveAgentCard = async (
  db: LobeChatDatabase,
  agentId: string,
  scope: { userId: string; workspaceId?: string | null },
): Promise<ContactCard> => {
  const [row] = await db
    .select({
      ...agentProfileColumns,
      agentVisibility: agents.visibility,
      agentWorkspaceId: agents.workspaceId,
    })
    .from(agents)
    .leftJoin(agentShares, eq(agentShares.agentId, agents.id))
    .leftJoin(owners, eq(owners.id, agents.userId))
    .where(and(eq(agents.id, agentId), notTrashed(agents.isDeleted)))
    .limit(1);
  // A public Agent of this workspace, shared inside it: every member reaches it already, so the
  // card needs no share and anyone of them may send it.
  const workspaceCard =
    !!row &&
    !!scope.workspaceId &&
    row.agentWorkspaceId === scope.workspaceId &&
    row.agentVisibility === 'public';
  const isOwner = !!row && row.ownerId === scope.userId;
  const shareable =
    row?.shareId && (row.visibility === 'link' || (row.visibility === 'card' && isOwner));
  if (!workspaceCard && !shareable) {
    if (isOwner)
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Turn on sharing first' });
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
  }
  const profile = toAgentProfile({ ...row!, shareId: row!.shareId ?? '' });
  return {
    agentId: profile.agentId,
    avatar: profile.avatar,
    backgroundColor: profile.backgroundColor,
    // The name every list shows: the personal name, else the role title.
    name: agentDisplayName(profile) ?? null,
    ownerName: profile.owner.fullName || profile.owner.username,
    shareId: workspaceCard ? null : profile.shareId,
    type: 'agent',
    ...(workspaceCard && { workspaceId: scope.workspaceId }),
  };
};
