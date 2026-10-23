import pc from 'picocolors';

import { log } from '../utils/logger';
import { getTrpcClient } from './client';

export interface WorkspaceRow {
  id: string;
  lockedOut?: boolean;
  name: string;
  plan?: string;
  role?: string | null;
  slug: string;
  updatedAt?: Date | string;
}

export const listWorkspaces = async (): Promise<WorkspaceRow[]> => {
  const client = await getTrpcClient();
  return (await client.workspace.list.query()) as WorkspaceRow[];
};

/** Accept either a workspace id or its slug; an id wins when both could match. */
export const findWorkspace = (
  workspaces: WorkspaceRow[],
  idOrSlug: string,
): WorkspaceRow | undefined =>
  workspaces.find((w) => w.id === idOrSlug) ?? workspaces.find((w) => w.slug === idOrSlug);

const exitNotFound = (idOrSlug: string, workspaces: WorkspaceRow[]): never => {
  log.error(`Workspace not found: ${idOrSlug}`);
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
 * When the caller's credentials cannot list workspaces, the value is passed
 * through as an id, which is how `--workspace` behaved before slugs.
 */
export const resolveWorkspaceRef = async (idOrSlug?: string): Promise<string | undefined> => {
  if (!idOrSlug) return undefined;

  let workspaces: WorkspaceRow[];
  try {
    workspaces = await listWorkspaces();
  } catch (error) {
    log.debug(`Could not list workspaces to resolve "${idOrSlug}"; using it as an id`, error);
    return idOrSlug;
  }

  return findWorkspace(workspaces, idOrSlug)?.id ?? exitNotFound(idOrSlug, workspaces);
};
