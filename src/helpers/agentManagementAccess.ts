/**
 * Client-side mirror of the server's management-access decision for an Agent
 * (`getGeneralAccess().canManage` — its author, or a workspace admin holding
 * `:all` on the resource; see `isResourceAuthorOrAdmin` on the server).
 *
 * The picker UI resolves this through `useAgentManagementAccess` (SWR), but
 * runtime resolution happens inside store actions where hooks can't run. The
 * hook publishes every resolved answer here so the send/regenerate/gateway
 * paths make the SAME manager-vs-member decision the picker made — otherwise a
 * workspace admin's own `local` pick would be discarded as a member override
 * under a `fixed` selection policy and the run would silently route to the
 * gateway or sandbox instead.
 *
 * Entries are keyed per user so a stale answer can never leak across an
 * account switch. When no answer has been resolved yet (e.g. a dispatch path
 * that never mounted the picker), callers fall back to authorship — the
 * historical behavior, and the correct one for every non-admin.
 */

const resolvedAccess = new Map<string, boolean>();

const cacheKey = (userId: string, agentId: string) => `${userId}:${agentId}`;

/** Record a server-resolved management-access answer for this user + agent. */
export const rememberAgentManagementAccess = (
  userId: string,
  agentId: string,
  canManage: boolean,
) => {
  resolvedAccess.set(cacheKey(userId, agentId), canManage);
};

/**
 * The management-access decision runtime resolvers should feed
 * `resolveAgentAgencyConfig` / `resolveAgentModelConfig` as `canManage`.
 * Authors always manage; otherwise only a server-confirmed `true` (published
 * by the picker's `useAgentManagementAccess`) promotes the caller to manager.
 */
export const getRuntimeCanManageAgent = (params: {
  agentId: string;
  agentUserId?: string | null;
  currentUserId?: string | null;
}): boolean => {
  const { agentId, agentUserId, currentUserId } = params;
  const isAuthor = !!currentUserId && !!agentUserId && agentUserId === currentUserId;
  if (isAuthor) return true;
  if (!currentUserId) return false;
  return resolvedAccess.get(cacheKey(currentUserId, agentId)) === true;
};

/** Test-only escape hatch so suites don't observe each other's entries. */
export const clearAgentManagementAccessCache = () => {
  resolvedAccess.clear();
};
