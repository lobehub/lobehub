import type { ContactAgentProfile } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { agents, agentShares, users } from '../schemas';
import { normalizeInboxAgentAvatar, normalizeInboxAgentTitle } from '../utils/inboxAgent';

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
