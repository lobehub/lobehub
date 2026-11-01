import { toRecord } from '@lobechat/utils/object';

import { resolveIdentityFingerprint } from '../auth/identity';
import { loadActiveWorkspace, resolveServerUrl } from '../settings';
import { log } from '../utils/logger';

export const WORKSPACE_ID_HEADER = 'X-Workspace-Id';

/**
 * `LOBEHUB_WORKSPACE_ID=personal` runs one command in personal scope. An empty
 * value falls through to the saved scope, and `workspace use --personal`
 * rewrites that scope for every later command, so there was no way to look
 * something up in personal space without changing the machine's default.
 */
export const PERSONAL_SCOPE_ENV_VALUE = 'personal';

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
  if (fromEnv === PERSONAL_SCOPE_ENV_VALUE) return { source: 'env' };
  if (fromEnv && fromEnv.length > 0) return { source: 'env', workspaceId: fromEnv };

  // A server-dispatched execution (operation-scoped `LOBEHUB_JWT`) carries its
  // complete scope in env: `LOBEHUB_WORKSPACE_ID` when the run is
  // workspace-scoped, nothing when personal. The persisted `workspace use`
  // scope belongs to whoever sits at this machine's terminal; letting it leak
  // into a dispatched run stamps every heteroIngest/heteroFinish call with a
  // workspace the run's topic is not in, and the server rejects the entire
  // event stream ("Topic is outside the caller scope").
  if (process.env.LOBEHUB_JWT) return { source: 'personal' };

  return resolvePersistedScope() ?? { source: 'personal' };
}

/**
 * The hint a `NOT_FOUND` needs when the command ran in a workspace scope. The
 * server cannot tell "does not exist" from "lives in another space", so a bare
 * "Goal not found" sent callers hunting for a deleted goal that was sitting in
 * their personal space.
 */
export function describeScopedNotFound(error: unknown): string | undefined {
  const data = toRecord(toRecord(error)?.data);
  if (data?.code !== 'NOT_FOUND') return;
  const { workspaceId } = resolveWorkspaceScope();
  if (!workspaceId) return;
  return `Looked in workspace ${workspaceId}. If it is in your personal space, rerun with LOBEHUB_WORKSPACE_ID=${PERSONAL_SCOPE_ENV_VALUE}; for another workspace, set LOBEHUB_WORKSPACE_ID=<id>.`;
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
