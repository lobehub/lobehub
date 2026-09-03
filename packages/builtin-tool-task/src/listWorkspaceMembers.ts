import type { TaskAssignableMember } from '@lobechat/prompts';

import type { ListWorkspaceMembersParams } from './types';

export const DEFAULT_LIST_WORKSPACE_MEMBERS_LIMIT = 50;
const MAX_LIST_WORKSPACE_MEMBERS_LIMIT = 100;

export interface ListWorkspaceMembersQuery {
  limit: number;
  query?: string;
}

// Native chat-platform mention wrappers the model may pass through verbatim:
// Slack `<@U123>` / `<@U123|name>`, Discord `<@4521>` / `<@!4521>` (nickname
// form). The wrapper carries no identity of its own — only the id inside does.
const NATIVE_MENTION_WRAPPER = /^<@!?([^\s>|]*)(?:\|[^>]*)?>$/;

/**
 * Fold a raw query into the needle `matchesMemberQuery` compares against:
 * trimmed and lower-cased, with a native mention wrapper or a leading `@`
 * stripped so `<@U123>`, `@neko` and `neko` all reach the same comparison.
 * `undefined` when nothing usable is left (blank, or a bare `@`).
 */
export const normalizeMemberQuery = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim() ?? '';
  const unwrapped = NATIVE_MENTION_WRAPPER.exec(trimmed)?.[1] ?? trimmed;
  const needle = (unwrapped.startsWith('@') ? unwrapped.slice(1) : unwrapped).trim().toLowerCase();
  return needle || undefined;
};

/**
 * Normalize tool-facing listWorkspaceMembers params: the folded `query` (see
 * `normalizeMemberQuery`, omitted when blank) and a `limit` clamped into the
 * supported range.
 */
export const normalizeListWorkspaceMembersParams = (
  params: ListWorkspaceMembersParams = {},
): ListWorkspaceMembersQuery => {
  const query = normalizeMemberQuery(params.query);
  const requested = Number.isFinite(params.limit)
    ? Math.floor(params.limit as number)
    : DEFAULT_LIST_WORKSPACE_MEMBERS_LIMIT;
  const limit = Math.min(Math.max(requested, 1), MAX_LIST_WORKSPACE_MEMBERS_LIMIT);
  return { limit, query };
};

/**
 * Whether a member matches a needle produced by `normalizeMemberQuery`: an
 * exact user id, or a case-insensitive substring of the display name, @handle,
 * email or any linked IM identity — so "neko", "@neko", "<@4521>",
 * "alice@acme.com" and a raw platform user id all resolve the same person.
 */
export const matchesMemberQuery = (member: TaskAssignableMember, needle: string): boolean => {
  if (!needle) return false;
  if (member.id.toLowerCase() === needle) return true;
  const haystacks = [member.name, member.username, member.email, ...(member.imAccounts ?? [])];
  return haystacks.some((value) => value?.toLowerCase().includes(needle));
};

/**
 * Narrow and cap the assignable-member directory for model-visible output.
 * Shared by the client executor and the server runtime so both surfaces apply
 * the same `query` / `limit` contract. `total` is the number of matches before
 * the cap, so the formatter can tell the model to refine instead of paging.
 */
export const selectAssignableMembers = (
  members: TaskAssignableMember[],
  params: ListWorkspaceMembersParams = {},
): { members: TaskAssignableMember[]; query?: string; total: number } => {
  const { limit, query } = normalizeListWorkspaceMembersParams(params);
  const matched = query ? members.filter((member) => matchesMemberQuery(member, query)) : members;
  return { members: matched.slice(0, limit), query, total: matched.length };
};
