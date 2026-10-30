import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { TRPCError } from '@trpc/server';

import type { EnvironmentInstanceModel } from '@/database/models/environmentInstance';
import { type DriveAccess, isPathWithin, sandboxStorageBinding } from '@/server/services/sandbox';
import { SandboxStorageFilesError } from '@/server/services/sandbox/storageFiles';

import { mapStorageError, type SandboxStorageClient } from './procedures';

/**
 * Whether a folder on the drive already holds something. `false` for one that
 * is not there or is empty; an unreachable drive is not read as either and
 * fails the call, since guessing "empty" could build over someone's work.
 */
export const isFolderOccupied = async (client: SandboxStorageClient, path: string) => {
  try {
    const listing = await client.listFiles({ path });
    return listing.entries.length > 0;
  } catch (error) {
    if (error instanceof SandboxStorageFilesError && error.status === 404) return false;
    return mapStorageError(error);
  }
};

export const assertFolderFree = async (client: SandboxStorageClient, path: string) => {
  if (await isFolderOccupied(client, path)) {
    throw new TRPCError({ code: 'CONFLICT', message: 'FOLDER_NOT_EMPTY' });
  }
};

/**
 * What a file route may touch on the drive, as paths relative to its root.
 *
 * Without an instance the whole drive is in reach: a personal drive is its
 * owner's, and the public drive's root and ordinary folders belong to every
 * member, who may list them and create, rename or delete folders in them. Two
 * kinds of folder are carved out of that, and both are environment
 * directories:
 *
 * - **Hidden** — a private environment's directory on the public drive, left
 *   over from before members had a personal drive; its home directory can
 *   hold the owner's credentials. It is left out of every listing and refused
 *   when named, for everyone, exactly as if it were not there — and so is a
 *   write to any folder that holds one, since moving or deleting that folder
 *   would carry the hidden one along and out into the open.
 *
 * With an instance the route is confined to that instance's directory, read
 * only, and goes to the drive the instance is on.
 */
export interface DriveScope {
  /** The client of the drive this scope is on. */
  client: SandboxStorageClient;
  /** Legacy private environment directories nobody may see; see above. */
  hidden: string[];
  /** Where a route is confined; `''` is the whole drive. */
  root: string;
}

export interface DriveContext {
  claim: { key: string };
  client: SandboxStorageClient;
  drive: SandboxDrive;
  drives: DriveAccess;
  instanceModel: EnvironmentInstanceModel;
  workspaceId?: string | null;
}

/**
 * The drive an instance is on, from the caller's side. Another member's
 * personal drive is not one of the caller's, so an instance there is answered
 * the way a missing one is.
 */
export const resolveInstanceDrive = async (
  ctx: Pick<DriveContext, 'drives'>,
  instance: { providerScope?: string | null },
) => {
  const drive = ctx.drives.driveOf(instance.providerScope);
  const access = drive ? await ctx.drives.client(drive) : undefined;
  if (!drive || !access) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

  return { ...access, drive };
};

/**
 * Refuses to build in or copy a private environment's directory left on the
 * public drive: it is hidden there and run by nobody, and the way forward is a
 * new copy on the owner's personal drive.
 */
export const assertNotLeftOnPublicDrive = async (
  ctx: Pick<DriveContext, 'instanceModel' | 'workspaceId'>,
  instance: { id: string },
  access: { claim: { key: string }; drive: SandboxDrive },
) => {
  if (!ctx.workspaceId || access.drive !== 'public') return;

  const directories = await ctx.instanceModel.listStorageDirectories(
    sandboxStorageBinding(access.claim.key),
  );
  if (directories.some((entry) => entry.id === instance.id && entry.isPrivate)) {
    throw new TRPCError({ code: 'CONFLICT', message: 'INSTANCE_REBUILD_REQUIRED' });
  }
};

/** Whether the scope's drive is a workspace's public one, shared by every member. */

export const isPublicDrive = (ctx: Pick<DriveContext, 'drive' | 'workspaceId'>) =>
  !!ctx.workspaceId && ctx.drive === 'public';

export const resolveDriveScope = async (
  ctx: DriveContext,
  instanceId?: string,
): Promise<DriveScope> => {
  if (instanceId) {
    const instance = await ctx.instanceModel.findById(instanceId);
    if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
    const { client } = await resolveInstanceDrive(ctx, instance);

    return {
      client,
      hidden: [],
      root: instance.workingDirectory,
    };
  }

  const directories = await ctx.instanceModel.listStorageDirectories(
    sandboxStorageBinding(ctx.claim.key),
  );

  return {
    client: ctx.client,
    hidden: isPublicDrive(ctx)
      ? directories.filter((entry) => entry.isPrivate).map((entry) => entry.workingDirectory)
      : [],
    root: '',
  };
};

/** Whether `path` is `root` itself or somewhere beneath it. */

export const isWithinRoot = (path: string, root: string) => !root || isPathWithin(path, root);

export const isHidden = (path: string, scope: DriveScope) =>
  scope.hidden.some((directory) => isPathWithin(path, directory));

export const assertReadable = (path: string, scope: DriveScope) => {
  if (!isWithinRoot(path, scope.root)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'PATH_OUTSIDE_INSTANCE' });
  }
  // The same answer a path that does not exist gets: a folder this member may
  // not see is not one they get to learn about by guessing its name.
  if (isHidden(path, scope)) throw new TRPCError({ code: 'NOT_FOUND', message: 'PATH_NOT_FOUND' });
};

/**
 * The scope a write on the drive runs in. A folder initialized from an
 * environment is an ordinary folder — environments are one-time initializers
 * — so it is written, renamed and deleted like any other. Only a write that
 * names a legacy instance is refused: that is the route an older client takes
 * into an environment directory's own state, which belongs to its builds.
 */
export const resolveWritableScope = async (
  ctx: DriveContext,
  { instanceId, path }: { instanceId?: string; path: string },
) => {
  if (instanceId) throw new TRPCError({ code: 'FORBIDDEN', message: 'INSTANCE_READ_ONLY' });

  const scope = await resolveDriveScope(ctx);
  assertReadable(path, scope);
  // Refused without naming what is inside: the caller can see this folder,
  // so "not found" would be false, and the hidden one stays unnamed.
  if (scope.hidden.some((directory) => isPathWithin(directory, path))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'PATH_HOLDS_HIDDEN' });
  }

  return scope;
};

/** Names the instance a file route works in; see {@link resolveDriveScope}. */

/**
 * The drive an environment's directories are made on: a private environment's
 * on its owner's personal drive, a published one's on the public drive every
 * member can run it from. A personal account has the one drive.
 */
export const driveForEnvironment = (
  environment: { visibility?: string | null; workspaceId?: string | null },
  workspaceId?: string | null,
): SandboxDrive => {
  if (!workspaceId) return 'personal';

  return environment.workspaceId && environment.visibility === 'private' ? 'personal' : 'public';
};
