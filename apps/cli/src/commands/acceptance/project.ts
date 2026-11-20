import path from 'node:path';

import { TRPCClientError } from '@trpc/client';

import type { TrpcClient } from '../../api/client';
import { resolveWorkspaceScope } from '../../api/workspace';
import { log } from '../../utils/logger';
import { findDeclaredProject } from './utils';

export interface AcceptanceProject {
  id: string;
  name: string;
  /** `--project` or the repository's `.agents/acceptance/config.json`. */
  source: 'config' | 'flag';
}

/**
 * The `acceptance.ensure` fields for a resolved project. A named project
 * overrides the subject's own; a repository's declaration only fills in when
 * the subject has none — a task or conversation filed under a project keeps it.
 */
export const projectEnsureInput = (project: AcceptanceProject | undefined) => {
  if (!project) return {};
  return project.source === 'flag' ? { projectId: project.id } : { fallbackProjectId: project.id };
};

const isNotFound = (error: unknown) =>
  error instanceof TRPCClientError && error.data?.code === 'NOT_FOUND';

const isUnchosenPersonalScope = () => {
  const scope = resolveWorkspaceScope();
  if (scope.workspaceId || process.env.LOBEHUB_JWT) return false;
  return scope.source === 'personal' || scope.source === 'stale';
};

/**
 * The project a delivery is filed under when the caller says so: `--project`,
 * else the project the repository declares (see {@link projectEnsureInput} for
 * how each ranks against the subject's own). Neither → undefined.
 *
 * A `--project` that names nothing is a typo the caller must fix, so it fails
 * before anything is written. A repository's declaration is shared by everyone
 * who checks it out, including people in a workspace without that project —
 * their round still publishes, just ungrouped.
 */
export async function resolveAcceptanceProject(
  client: TrpcClient,
  options: { flag?: string; startDirs: string[] },
): Promise<AcceptanceProject | undefined> {
  const flag = options.flag?.trim();
  if (options.flag !== undefined && !flag) throw new Error('--project must not be empty');
  if (flag) {
    try {
      const { data } = await client.project.find.query({ id: flag });
      return { id: data.id, name: data.name, source: 'flag' };
    } catch (error) {
      if (isNotFound(error)) {
        throw new Error(`--project "${flag}" matches no project in this workspace.`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  const declared = findDeclaredProject(options.startDirs);
  if (!declared) return;
  const file = path.relative(process.cwd(), declared.file) || declared.file;
  if (declared.kind === 'invalid') {
    log.warn(`Ignoring ${file}: ${declared.reason}.`);
    return;
  }

  // Only the acceptance's own workspace lets its members review it, so a
  // round published from personal space is the creator's alone — a terminal
  // that never chose a workspace looks like a teammate's missing permission.
  // Say so whether or not personal space happens to have the project. An
  // explicit `LOBEHUB_WORKSPACE_ID=personal` or a server-dispatched run (whose
  // scope the server sets) meant to be personal, so neither is told to change it.
  const warnPersonalScope = () => {
    if (!isUnchosenPersonalScope()) return false;
    log.warn(
      `${file} files acceptances under project "${declared.project}", but this command runs in your personal space, so workspace teammates cannot review this acceptance — only you can. To publish to the project's workspace instead, set LOBEHUB_WORKSPACE_ID=<workspace id> or run 'lh workspace use <workspace>'.`,
    );
    return true;
  };

  try {
    const { data } = await client.project.find.query({ id: declared.project });
    warnPersonalScope();
    return { id: data.id, name: data.name, source: 'config' };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    if (warnPersonalScope()) return;
    log.warn(
      `${file} files acceptances under project "${declared.project}", which this workspace does not have — publishing ungrouped.`,
    );
  }
}

/**
 * A named project only files an acceptance that has none yet — a delivery
 * already grouped is never moved by a later round. Say so when that is why
 * `--project` did not take, instead of letting the caller believe it did. A
 * repository's declaration yielding to an existing project is its design, not
 * news.
 */
export function warnIfFiledElsewhere(
  project: AcceptanceProject | undefined,
  acceptance: { projectId?: string | null },
) {
  if (project?.source !== 'flag') return;
  if (!acceptance.projectId || acceptance.projectId === project.id) return;
  log.warn(
    `This acceptance is already filed under another project, so it stays there instead of "${project.name}". Move it from the acceptance list.`,
  );
}
