import { loadActiveWorkspaceId } from '../settings';

export const WORKSPACE_ID_HEADER = 'X-Workspace-Id';

export type WorkspaceScopeSource = 'explicit' | 'env' | 'settings' | 'personal';

export interface WorkspaceScope {
  source: WorkspaceScopeSource;
  workspaceId?: string;
}

/**
 * Resolve the workspace scope for outbound API calls, along with where it came
 * from — `lh workspace current` and `lh whoami` report the source so a caller
 * can tell "wrong workspace" from "not found".
 *
 * Precedence: explicit caller arg -> `LOBEHUB_WORKSPACE_ID` env ->
 * `lh workspace use` (persisted) -> personal mode.
 */
export function resolveWorkspaceScope(explicit?: string): WorkspaceScope {
  if (explicit) return { source: 'explicit', workspaceId: explicit };

  const fromEnv = process.env.LOBEHUB_WORKSPACE_ID;
  if (fromEnv && fromEnv.length > 0) return { source: 'env', workspaceId: fromEnv };

  const fromSettings = loadActiveWorkspaceId();
  if (fromSettings) return { source: 'settings', workspaceId: fromSettings };

  return { source: 'personal' };
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
