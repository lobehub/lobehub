import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE, INBOX_SESSION_ID } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { sql } from 'drizzle-orm';

import { agents } from '../schemas';

interface InboxAgentIdentity {
  slug?: string | null;
}

interface InboxAgentMeta {
  avatar: string | null;
  title: string | null;
}

const isBlank = (value: string | null | undefined) => !value || value.trim().length === 0;

export const isInboxAgentIdentity = ({ slug }: InboxAgentIdentity) => slug === INBOX_SESSION_ID;

export function normalizeInboxAgentTitle(
  title: string | null,
  identity: InboxAgentIdentity,
): string | null;
export function normalizeInboxAgentTitle(
  title: string | null | undefined,
  identity: InboxAgentIdentity,
): string | null | undefined;
export function normalizeInboxAgentTitle(
  title: string | null | undefined,
  identity: InboxAgentIdentity,
) {
  return isInboxAgentIdentity(identity) && isBlank(title) ? DEFAULT_INBOX_TITLE : title;
}

export function normalizeInboxAgentAvatar(
  avatar: string | null,
  identity: InboxAgentIdentity,
): string | null;
export function normalizeInboxAgentAvatar(
  avatar: string | null | undefined,
  identity: InboxAgentIdentity,
): string | null | undefined;
export function normalizeInboxAgentAvatar(
  avatar: string | null | undefined,
  identity: InboxAgentIdentity,
) {
  return isInboxAgentIdentity(identity) && isBlank(avatar) ? DEFAULT_INBOX_AVATAR : avatar;
}

export const normalizeInboxAgentMeta = <T extends InboxAgentMeta>(
  agent: T,
  identity: InboxAgentIdentity = agent as T & InboxAgentIdentity,
): T => ({
  ...agent,
  avatar: normalizeInboxAgentAvatar(agent.avatar, identity),
  title: normalizeInboxAgentTitle(agent.title, identity),
});

interface AgentLabelFields extends InboxAgentIdentity {
  name?: string | null;
  title?: string | null;
}

/**
 * The label a stored Agent row is shown by: its `name`, else its `title`, the inbox's blank title
 * read as `DEFAULT_INBOX_TITLE`. Use it wherever a server read turns an Agent row into a name, so
 * the inbox never surfaces as nameless.
 */
export const resolveAgentLabel = (agent: AgentLabelFields, fallback: string) =>
  agentDisplayName(
    { name: agent.name, title: normalizeInboxAgentTitle(agent.title, agent) },
    fallback,
  );

/** {@link normalizeInboxAgentAvatar} in SQL, selected in place of `agents.avatar`. */
export const agentAvatarSql = () =>
  sql<
    string | null
  >`case when ${agents.slug} = ${INBOX_SESSION_ID} and nullif(trim(${agents.avatar}), '') is null then ${DEFAULT_INBOX_AVATAR} else ${agents.avatar} end`;

/**
 * {@link normalizeInboxAgentTitle} in SQL. Select it in place of `agents.title` wherever a query
 * reads an Agent's name, so the inbox's blank title reads as `DEFAULT_INBOX_TITLE`.
 */
export const agentTitleSql = () =>
  sql<
    string | null
  >`case when ${agents.slug} = ${INBOX_SESSION_ID} and nullif(trim(${agents.title}), '') is null then ${DEFAULT_INBOX_TITLE} else ${agents.title} end`;
