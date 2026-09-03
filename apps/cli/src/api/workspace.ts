import { resolveIdentityFingerprint } from '../auth/identity';
import { loadActiveWorkspace, resolveServerUrl } from '../settings';
import { log } from '../utils/logger';

export const WORKSPACE_ID_HEADER = 'X-Workspace-Id';

export type WorkspaceScopeSource = 'explicit' | 'env' | 'settings' | 'stale' | 'personal';

export interface WorkspaceScope {
  source: WorkspaceScopeSource;
  workspaceId?: string;
}

let warnedAboutStaleScope = false;

/**
 * A persisted scope only counts when the server and account it was chosen under
 * still match. Cloud answers an `X-Workspace-Id` the caller has no membership in
 * by quietly falling back to personal scope, so a scope left over from another
 * account would route reads *and writes* to personal data while every status
 * line still said "workspace".
 */
function resolvePersistedScope(): WorkspaceScope | undefined {
  const stored = loadActiveWorkspace();
  if (!stored) return undefined;

  const identity = resolveIdentityFingerprint();
  const reason = !identity
    ? "the current credentials don't identify an account — set LOBEHUB_WORKSPACE_ID instead"
    : identity !== stored.identity
      ? `it was set under a different account. Run 'workspace use' again to re-select it`
      : stored.serverUrl !== resolveServerUrl()
        ? `it was set for ${stored.serverUrl}`
        : undefined;

  if (!reason) return { source: 'settings', workspaceId: stored.workspaceId };

  if (!warnedAboutStaleScope) {
    warnedAboutStaleScope = true;
    log.warn(`Ignoring the saved workspace scope (${stored.workspaceId}): ${reason}.`);
  }

  return { source: 'stale' };
}

/**
 * Resolve the workspace scope for outbound API calls, along with where it came
 * from — `lh workspace current` and `lh whoami` report the source so a caller
 * can tell "wrong workspace" from "not found".
 *
 * Precedence: explicit caller arg -> `LOBEHUB_WORKSPACE_ID` env ->
 * `lh workspace use` (persisted, and still bound to this account/server) ->
 * personal mode.
 */
export function resolveWorkspaceScope(explicit?: string): WorkspaceScope {
  if (explicit) return { source: 'explicit', workspaceId: explicit };

  const fromEnv = process.env.LOBEHUB_WORKSPACE_ID;
  if (fromEnv && fromEnv.length > 0) return { source: 'env', workspaceId: fromEnv };

  return resolvePersistedScope() ?? { source: 'personal' };
}

export function resolveWorkspaceId(explicit?: string): string | undefined {
  return resolveWorkspaceScope(explicit).workspaceId;
}

export function withWorkspaceHeader(
  headers: Record<string, string>,
  workspaceId?: string,
): Record<string, string> {
  const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
  return resolvedWorkspaceId ? { ...headers, [WORKSPACE_ID_HEADER]: resolvedWorkspaceId } : headers;
}

/** Test seam: the stale-scope warning is emitted at most once per process. */
export function __resetStaleScopeWarning(): void {
  warnedAboutStaleScope = false;
}
