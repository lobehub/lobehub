import type { TaskAssignableMember } from '@lobechat/prompts';

import type { ListWorkspaceMembersParams } from './types';

export const DEFAULT_LIST_WORKSPACE_MEMBERS_LIMIT = 50;
const MAX_LIST_WORKSPACE_MEMBERS_LIMIT = 100;

export interface ListWorkspaceMembersQuery {
  limit: number;
  query?: string;
}

/**
 * Normalize tool-facing listWorkspaceMembers params: a trimmed, case-folded
 * `query` (omitted when blank) and a `limit` clamped into the supported range.
 */
export const normalizeListWorkspaceMembersParams = (
  params: ListWorkspaceMembersParams = {},
): ListWorkspaceMembersQuery => {
  const query = params.query?.trim().toLowerCase() || undefined;
  const requested = Number.isFinite(params.limit)
    ? Math.floor(params.limit as number)
    : DEFAULT_LIST_WORKSPACE_MEMBERS_LIMIT;
  const limit = Math.min(Math.max(requested, 1), MAX_LIST_WORKSPACE_MEMBERS_LIMIT);
  return { limit, query };
};

/**
 * Whether a member matches a (normalized, lower-cased) query: an exact user id,
 * or a case-insensitive substring of the display name, @handle, email or any
 * linked IM identity — so "neko", "@neko", "alice@acme.com" and a raw
 * platform user id all resolve the same person.
 */
export const matchesMemberQuery = (member: TaskAssignableMember, query: string): boolean => {
  if (member.id === query) return true;
  const needle = query.startsWith('@') ? query.slice(1) : query;
  if (!needle) return false;
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
