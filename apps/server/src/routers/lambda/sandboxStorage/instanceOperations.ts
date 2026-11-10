import {
  derivedInstanceDirectory,
  MAX_DERIVED_DIRECTORY_ATTEMPTS,
} from '@lobechat/utils/environmentInstance';
import { TRPCError } from '@trpc/server';

import type { EnvironmentInstanceModel } from '@/database/models/environmentInstance';
import { InstanceDirectoryOverlapError } from '@/database/models/environmentInstance';
import { sandboxStorageBinding } from '@/server/services/sandbox';
import { SandboxStorageFilesError } from '@/server/services/sandbox/storageFiles';

import { isDuplicateInstanceDirectory } from './constraintErrors';
import { isFolderOccupied } from './driveScope';
import { mapStorageError, type SandboxStorageClient } from './procedures';

/**
 * Whether building from this definition does anything: an environment that
 * clones nothing and installs nothing is already everything it will ever be.
 * Shared by the build itself, which settles such an instance without starting
 * a sandbox, and the listing, which is how the row knows a rebuild would be a
 * no-op rather than a folder thrown away.
 */
export const isBuildable = (
  specification: { bootstrapCommand?: string | null; sources?: unknown[] | null } | null,
): boolean => (specification?.sources?.length ?? 0) > 0 || Boolean(specification?.bootstrapCommand);

/**
 * A new sandbox instance of an environment the caller owns, with its directory
 * derived from the environment's name rather than asked for.
 *
 * The directory is searched rather than computed in one shot: the unique
 * index spans the whole workspace, not one environment, so a name that is
 * free inside this environment can still be taken outside it. The index stays
 * the authority — the pre-check only keeps the common case out of the error
 * path, and a lost race falls through to the next suffix.
 */
export const createDerivedInstance = async (
  instanceModel: EnvironmentInstanceModel,
  client: SandboxStorageClient,
  workspaceKey: string,
  environment: { id: string; name: string },
) => {
  for (let attempt = 1; attempt <= MAX_DERIVED_DIRECTORY_ATTEMPTS; attempt += 1) {
    const workingDirectory = derivedInstanceDirectory(environment.name, attempt);

    if (await instanceModel.findByWorkingDirectory(workingDirectory, workspaceKey)) continue;
    // An ordinary folder of the same name is somebody's work, not a free name.
    if (await isFolderOccupied(client, workingDirectory)) continue;

    const created = await instanceModel
      .create({
        ...sandboxStorageBinding(workspaceKey),
        environmentId: environment.id,
        // The directory is the only thing that distinguishes this instance
        // from its siblings right now, so it is also the only honest label
        // until the person renames it.
        name: workingDirectory,
        workingDirectory,
      })
      .catch((error: unknown) => {
        // Someone else took this directory between the check and the
        // insert, or it nests with another instance's. Not a conflict the
        // caller can act on — try the next one.
        if (isDuplicateInstanceDirectory(error)) return undefined;
        if (error instanceof InstanceDirectoryOverlapError) return undefined;
        throw error;
      });

    if (!created) continue;

    // Nothing to clone and nothing to install means nothing will ever build
    // this instance, so it is ready as it is written. Left to the client's
    // follow-up build call, a tab closed in between would strand it in
    // `pending` — and a files environment offers no rebuild to get out of it.
    if (isBuildable(created.configurationSnapshot)) return created;

    await instanceModel.update(created.id, { status: 'ready' });

    return { ...created, status: 'ready' as const };
  }

  throw new TRPCError({ code: 'CONFLICT', message: 'DUPLICATE_INSTANCE_DIRECTORY' });
};

/**
 * Drop an instance's built state on the execution plane, ahead of its row.
 *
 * No snapshot there is the state this call exists to reach, so a 404 is this
 * step succeeding, not failing. An instance nothing has ever run in has
 * nothing on the execution plane — and treating that as an error strands the
 * row permanently, because the environment holding it cannot be deleted
 * either while an instance references it.
 */
export const deleteInstanceSnapshot = (
  client: SandboxStorageClient,
  id: string,
  topicId?: string,
) =>
  client.deleteInstance({ name: id, topicId }).catch((error: unknown) => {
    if (error instanceof SandboxStorageFilesError && error.status === 404) return;

    return mapStorageError(error);
  });
