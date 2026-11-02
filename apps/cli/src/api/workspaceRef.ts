import { isTRPCClientError } from '@trpc/client';
import pc from 'picocolors';

import { pickAuthSource } from '../auth/source';
import { log } from '../utils/logger';
import { getTrpcClient } from './client';
import { markScopeFromFlag, PERSONAL_SCOPE_ENV_VALUE } from './workspace';

export interface WorkspaceRow {
  id: string;
  lockedOut?: boolean;
  name: string;
  plan?: string;
  role?: string | null;
  slug: string;
  updatedAt?: Date | string;
}

/**
 * Membership does not depend on the scope, but the env value may be the very
 * slug or typo being resolved, so it must not go out as `X-Workspace-Id`.
 */
export const listWorkspaces = async (): Promise<WorkspaceRow[]> => {
  const fromEnv = process.env.LOBEHUB_WORKSPACE_ID;
  // `personal` rather than unset, which would fall through to the saved scope.
  process.env.LOBEHUB_WORKSPACE_ID = PERSONAL_SCOPE_ENV_VALUE;
  try {
    const client = await getTrpcClient();
    return (await client.workspace.list.query()) as WorkspaceRow[];
  } finally {
    if (fromEnv === undefined) delete process.env.LOBEHUB_WORKSPACE_ID;
    else process.env.LOBEHUB_WORKSPACE_ID = fromEnv;
  }
};

/** Accept either a workspace id or its slug; an id wins when both could match. */
export const findWorkspace = (
  workspaces: WorkspaceRow[],
  idOrSlug: string,
): WorkspaceRow | undefined =>
  workspaces.find((w) => w.id === idOrSlug) ?? workspaces.find((w) => w.slug === idOrSlug);

const exitNotFound = (idOrSlug: string, workspaces: WorkspaceRow[], origin?: string): never => {
  log.error(`Workspace not found: ${idOrSlug}${origin ? ` (from ${origin})` : ''}`);
  if (workspaces.length > 0) {
    console.log(pc.dim('Available:'));
    for (const w of workspaces) console.log(pc.dim(`  ${w.id}  ${w.slug}  ${w.name}`));
  }
  process.exit(1);
};

/**
 * Resolve a workspace id or slug the caller belongs to, exiting with the
 * available workspaces when it matches none. Cloud answers an unknown
 * `X-Workspace-Id` by falling back to personal scope, so a slug passed through
 * as-is would silently read the wrong tenant.
 */
export const resolveWorkspace = async (idOrSlug: string): Promise<WorkspaceRow> => {
  const workspaces = await listWorkspaces();
  return findWorkspace(workspaces, idOrSlug) ?? exitNotFound(idOrSlug, workspaces);
};

/**
 * Turn an optional `--workspace <id|slug>` value into a workspace id. Leaves
 * `undefined` alone so the ambient scope (env, `workspace use`) still applies.
 * When the caller's credentials are refused `workspace.list`, the value is
 * passed through as an id (how `--workspace` behaved before slugs) with a warning.
 */
export const resolveWorkspaceRef = async (
  idOrSlug?: string,
  origin?: string,
): Promise<string | undefined> => {
  if (!idOrSlug) return undefined;

  let workspaces: WorkspaceRow[];
  try {
    workspaces = await listWorkspaces();
  } catch (error) {
    // Only a scope refusal passes through. Any other failure (network, server)
    // is not evidence the value is an id, and forwarding a slug would read the
    // personal scope instead.
    if (!isTRPCClientError(error) || error.data?.code !== 'FORBIDDEN') throw error;

    // Keep ids working for credentials scoped below `workspace:read`, but say
    // so: a slug sent as `X-Workspace-Id` is rejected or read the wrong scope.
    log.debug('workspace.list failed', error);
    // The env var is how an API key picks its scope, and the server rejects a
    // wrong value for API keys rather than falling back, so don't warn every run.
    if (origin && pickAuthSource().kind === 'env-api-key') return idOrSlug;

    log.warn(
      `Could not look up workspaces with these credentials, so "${idOrSlug}" is used as a workspace id. If it is a slug, pass the workspace id instead.`,
    );
    return idOrSlug;
  }

  return findWorkspace(workspaces, idOrSlug)?.id ?? exitNotFound(idOrSlug, workspaces, origin);
};

/**
 * Commands that must keep working whatever the ambient scope is: they never
 * read workspace data, they exist to repair auth and diagnose the scope, or they
 * authenticate with their own `--token` rather than the login a lookup would use.
 */
const AMBIENT_SCOPE_FREE_COMMANDS = new Set([
  '__complete',
  'completion',
  'connect',
  'doctor',
  'login',
  'logout',
  'man',
  'status',
  'tool-worker',
  'update',
]);

/**
 * Resolve the global `--workspace` flag and `LOBEHUB_WORKSPACE_ID` before a
 * command runs, leaving the resolved id in the env for this process and its
 * children. Nothing is persisted. A value that matches no workspace exits here,
 * because Cloud would otherwise answer the unknown header from another scope.
 *
 * A dispatched run (`LOBEHUB_JWT`) skips the env lookup: the server wrote that
 * id itself, and its operation token is refused by `workspace.list`. So does a
 * command given its own `--workspace`, which outranks the env value anyway.
 */
export const applyWorkspaceOverride = async (
  flag: string | undefined,
  commandName: string,
  hasOwnWorkspace = false,
): Promise<void> => {
  if (flag !== undefined) {
    const value = flag.trim();
    // `-w "$UNSET"` must not quietly fall through to the saved scope.
    if (!value) {
      log.error('--workspace needs a workspace id or slug.');
      process.exit(1);
    }

    // `doctor` reports the scope; the rest would drop the flag and exit 0, and
    // `connect` would enroll a personal device while the user asked for a workspace.
    if (commandName !== 'doctor' && AMBIENT_SCOPE_FREE_COMMANDS.has(commandName)) {
      log.error(
        commandName === 'connect'
          ? `The global --workspace does not apply to connect. Use 'connect --workspace <id>'.`
          : `The global --workspace does not apply to ${commandName}.`,
      );
      process.exit(1);
    }

    process.env.LOBEHUB_WORKSPACE_ID =
      value === PERSONAL_SCOPE_ENV_VALUE ? value : await resolveWorkspaceRef(value);
    markScopeFromFlag();
    return;
  }

  const fromEnv = process.env.LOBEHUB_WORKSPACE_ID;
  if (!fromEnv || fromEnv === PERSONAL_SCOPE_ENV_VALUE) return;
  if (process.env.LOBEHUB_JWT || hasOwnWorkspace || AMBIENT_SCOPE_FREE_COMMANDS.has(commandName))
    return;

  process.env.LOBEHUB_WORKSPACE_ID = await resolveWorkspaceRef(fromEnv, 'LOBEHUB_WORKSPACE_ID');
};
