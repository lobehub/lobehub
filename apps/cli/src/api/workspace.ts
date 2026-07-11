export const WORKSPACE_ID_HEADER = 'X-Workspace-Id';

/**
 * Resolve the workspace scope for outbound API calls.
 *
 * Precedence: explicit caller arg -> `LOBEHUB_WORKSPACE_ID` env -> personal mode.
 */
export function resolveWorkspaceId(explicit?: string): string | undefined {
  if (explicit) return explicit;
  const fromEnv = process.env.LOBEHUB_WORKSPACE_ID;
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

export function withWorkspaceHeader(
  headers: Record<string, string>,
  workspaceId?: string,
): Record<string, string> {
  const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
  return resolvedWorkspaceId ? { ...headers, [WORKSPACE_ID_HEADER]: resolvedWorkspaceId } : headers;
}
