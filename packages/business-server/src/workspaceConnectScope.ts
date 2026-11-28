/**
 * Workspace-scoped LobeHub Skill connections (GitHub, Linear, X, …) belong to
 * the workspace's account on Market, so that account — and the caller's
 * membership in it — has to exist before the workspace can be authorized.
 * Called only after Market refused an authorization; returns whether anything
 * was done, so the caller knows whether retrying can help.
 *
 * The open-source build has no workspaces on Market, so this does nothing. A
 * deployment that mirrors workspaces into Market overrides this module through
 * its own `@/business/server/...` mapping.
 */
export interface EnsureWorkspaceConnectScopeParams {
  userId: string;
  workspaceId: string;
}

export const ensureWorkspaceConnectScope = async (
  _params: EnsureWorkspaceConnectScopeParams,
): Promise<boolean> => false;
