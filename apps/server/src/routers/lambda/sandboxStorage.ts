import {
  DEFAULT_SANDBOX_DRIVE,
  SANDBOX_DRIVES,
  type SandboxDrive,
} from '@lobechat/builtin-tool-cloud-sandbox';
import { toExecutionConfiguration } from '@lobechat/types';
import {
  derivedInstanceDirectory,
  MAX_DERIVED_DIRECTORY_ATTEMPTS,
} from '@lobechat/utils/environmentInstance';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import {
  type WorkspaceRole,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { EnvironmentModel } from '@/database/models/environment';
import {
  EnvironmentInstanceModel,
  InstanceDirectoryOverlapError,
} from '@/database/models/environmentInstance';
import { TopicModel } from '@/database/models/topic';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { MarketService } from '@/server/services/market';
import {
  createDriveAccess,
  type DriveAccess,
  forgetDriveFolders,
  isPathWithin,
  readDriveUsage,
  resolveSandboxSessionConfig,
  resolveSandboxStorageClaim,
  sandboxStorageBinding,
} from '@/server/services/sandbox';
import { SandboxStorageFilesError } from '@/server/services/sandbox/storageFiles';
import { resolveScmCloneCredential } from '@/server/services/scm/cloneCredential';

import { getPostgresErrorField } from './_helpers/environmentErrors';
import { idSchema, nameSchema, relativePathSchema } from './_schema/environment';

/**
 * Browsing and managing the user's network drives, and the environment
 * directories (instances) initialized on them.
 *
 * A personal account has one drive. A workspace has two kinds: the public
 * drive every member shares, and one personal drive per member that only they
 * can reach. Every call names the drive it means (`drive`, defaulting to the
 * public one in a workspace); the claim it is signed with is issued for that
 * drive alone, so a path can only ever mean a folder on the drive named. A
 * call about one environment directory goes to the drive that directory is on,
 * whatever it names.
 *
 * The drive lives on a volume mounted into the sandbox runtime. Paths are
 * always relative to the drive's root; the absolute mount path never reaches a
 * client, which leaves nothing for one to smuggle back. Everything here needs
 * the drive, so everything here needs the entitlement — the definitions the
 * instances are built from do not, and live in the `environment` router.
 */

/**
 * An environment directory's path: one folder at the drive's root, never
 * nested. Every member's environment directories sit side by side there, which
 * is what lets a listing tell them apart from ordinary folders at a glance.
 */
const instanceDirectorySchema = relativePathSchema.refine((value) => !value.includes('/'), {
  message: 'An environment directory sits at the root of the drive',
});

/**
 * Topic whose warm sandbox session should serve the call, so listing a
 * directory does not cold-start a second sandbox next to the one the user is
 * already talking to.
 */
const topicIdSchema = z.string().min(1).max(255).optional();

/** Which workspace drive a call addresses; see the router's own note. */
const driveSchema = z.enum(SANDBOX_DRIVES).optional();

/**
 * Ceiling on a single write. Generous for anything a person edits by hand and
 * small enough that a runaway body is refused before it is buffered — this is
 * an editor's save path, not a bulk upload.
 */
const MAX_FILE_CONTENT_BYTES = 1024 * 1024;

/**
 * Checked in UTF-8 bytes, which is what the cap is denominated in and what the
 * execution plane actually receives. `z.string().max()` counts UTF-16 code
 * units, so a megabyte of CJK would pass it and send roughly three.
 */
const fileContentSchema = z
  .string()
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_FILE_CONTENT_BYTES, {
    message: `File content exceeds ${MAX_FILE_CONTENT_BYTES} bytes`,
  });

/**
 * Whether building from this definition does anything: an environment that
 * clones nothing and installs nothing is already everything it will ever be.
 * Shared by the build itself, which settles such an instance without starting
 * a sandbox, and the listing, which is how the row knows a rebuild would be a
 * no-op rather than a folder thrown away.
 */
const isBuildable = (
  specification: { bootstrapCommand?: string | null; sources?: unknown[] | null } | null,
): boolean => (specification?.sources?.length ?? 0) > 0 || Boolean(specification?.bootstrapCommand);

/**
 * Statuses the execution plane uses deliberately, each carrying something the
 * user can act on. Anything else is a fault on the far side and says so.
 *
 * `409` is the one worth naming: it means a conversation is still using this
 * environment. Collapsing it into a generic upstream failure would replace the
 * only actionable message with one that suggests the product is broken.
 */
const WORKSPACE_ERROR_CODES: Record<number, TRPCError['code']> = {
  400: 'BAD_REQUEST',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  // The workspace is out of quota — the user frees space or upgrades.
  507: 'PAYLOAD_TOO_LARGE',
};

const mapStorageError = (error: unknown): never => {
  if (error instanceof SandboxStorageFilesError) {
    throw new TRPCError({
      code: WORKSPACE_ERROR_CODES[error.status] ?? 'BAD_GATEWAY',
      // The machine code when the market sent one, the way this router's own
      // refusals travel (`ENVIRONMENT_HAS_INSTANCES`): the client turns a code
      // into a sentence in the reader's language. The description beside it
      // names the row by its id, so forwarding it verbatim put a UUID in a
      // toast — accurate, and useless to the person reading it.
      message: error.code || error.message,
    });
  }

  throw error;
};

/**
 * Resolves the caller's sandbox-storage claim for the drive the call names:
 * which directory on the volume they are entitled to and how large it may be.
 *
 * It reads `ctx.workspaceId`, but that is the TEAM workspace, and it is read
 * only to decide whose storage this is — inside a team the public drive or
 * the member's personal one, otherwise their personal account's. The claim
 * itself has nothing to do with the team workspace, which is why neither this
 * nor anything built on it is named after one.
 *
 * A call that names no drive but names a topic addresses the topic's: the
 * working panel lists the conversation's own folder, and that folder is on
 * the drive the conversation picked.
 *
 * The caller is always acting as themselves here — a signed-in user browsing
 * their own storage, not an agent run executing under someone else's identity
 * — so there is no share-visitor case to suppress.
 */
const storageClaimProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;
  const raw = (await opts.getRawInput()) as { drive?: unknown; topicId?: unknown } | undefined;

  let drive: SandboxDrive = workspaceId ? DEFAULT_SANDBOX_DRIVE : 'personal';
  const named = driveSchema.safeParse(raw?.drive);
  if (workspaceId && named.success && named.data) {
    drive = named.data;
  } else if (workspaceId && typeof raw?.topicId === 'string' && raw.topicId) {
    // A lookup that fails leaves the call on the public drive, the default a
    // topic without a drive of its own means anyway.
    try {
      const topic = await new TopicModel(ctx.serverDB, ctx.userId, workspaceId).findById(
        raw.topicId,
      );
      if (topic?.metadata?.sandboxDrive === 'personal') drive = 'personal';
    } catch {
      /* keep the default */
    }
  }

  const drives = createDriveAccess({
    resolveClaim: resolveSandboxStorageClaim,
    serverDB: ctx.serverDB,
    userId: ctx.userId,
    workspaceId,
  });
  const claim = await drives.claim(drive);

  return opts.next({
    ctx: {
      claim,
      drive,
      drives,
      marketService: new MarketService({
        userInfo: { sandboxStorage: claim, userId: ctx.userId, workspaceId },
      }),
    },
  });
});

/**
 * Everything past the entitlement check. Without a claim there is no directory
 * to address — the execution plane would reject the call anyway, and failing
 * here keeps a client that renders the panel too eagerly from looking like a
 * server fault.
 */
const entitledProcedure = storageClaimProcedure.use(async (opts) => {
  const { claim, marketService } = opts.ctx;
  if (!claim) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This account has no persistent sandbox workspace',
    });
  }

  return opts.next({ ctx: { claim, client: marketService.getSandboxStorageClient() } });
});

/**
 * The topic the execution plane keys its file-browser console sessions to.
 * The same literal market uses (`MANAGEMENT_TOPIC_ID`); it is not a topic of
 * ours, so it is never looked up and the run is shown as a console session.
 */
const MANAGEMENT_TOPIC_ID = 'sandbox-workspace-console';

/** The index that keeps two instances out of the same directory. */
const INSTANCE_DIRECTORY_CONSTRAINT = 'environment_instances_provider_path_unique';

/**
 * Two instances in one directory would restore two package sets over each
 * other's files, so the database refuses it and the person picks another
 * directory. Same reasoning as a duplicate name, different fix.
 */
const isDuplicateInstanceDirectory = (error: unknown): boolean =>
  getPostgresErrorField(error, 'code') === '23505' &&
  getPostgresErrorField(error, 'constraint') === INSTANCE_DIRECTORY_CONSTRAINT;

const rethrowDuplicateInstanceDirectory = (error: unknown): never => {
  // The same fix for the person — pick another folder — but a different
  // sentence, since the folder itself is not taken.
  if (error instanceof InstanceDirectoryOverlapError) {
    throw new TRPCError({
      cause: error,
      code: 'CONFLICT',
      message: 'OVERLAPPING_INSTANCE_DIRECTORY',
    });
  }

  if (isDuplicateInstanceDirectory(error)) {
    throw new TRPCError({
      cause: error,
      code: 'CONFLICT',
      message: 'DUPLICATE_INSTANCE_DIRECTORY',
    });
  }

  throw error;
};

/**
 * An environment is a specification plus whatever has been built from it. This
 * layer owns the specification; the snapshot belongs to the execution plane and
 * is addressed by the row's id.
 *
 * An environment that was created but never used has no snapshot yet, which is
 * a normal state and not an error: it becomes real the first time a session
 * using it ends.
 */
const environmentProcedure = entitledProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      environmentModel: new EnvironmentModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

const instanceProcedure = environmentProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      instanceModel: new EnvironmentInstanceModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

type SandboxStorageClient = ReturnType<MarketService['getSandboxStorageClient']>;

/**
 * Whether a folder on the drive already holds something. `false` for one that
 * is not there or is empty; an unreachable drive is not read as either and
 * fails the call, since guessing "empty" could build over someone's work.
 */
const isFolderOccupied = async (client: SandboxStorageClient, path: string) => {
  try {
    const listing = await client.listFiles({ path });
    return listing.entries.length > 0;
  } catch (error) {
    if (error instanceof SandboxStorageFilesError && error.status === 404) return false;
    return mapStorageError(error);
  }
};

const assertFolderFree = async (client: SandboxStorageClient, path: string) => {
  if (await isFolderOccupied(client, path)) {
    throw new TRPCError({ code: 'CONFLICT', message: 'FOLDER_NOT_EMPTY' });
  }
};

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
const createDerivedInstance = async (
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
const deleteInstanceSnapshot = (client: SandboxStorageClient, id: string, topicId?: string) =>
  client.deleteInstance({ name: id, topicId }).catch((error: unknown) => {
    if (error instanceof SandboxStorageFilesError && error.status === 404) return;

    return mapStorageError(error);
  });

/**
 * What a file route may touch on the drive, as paths relative to its root.
 *
 * Without an instance the whole drive is in reach: a personal drive is its
 * owner's, and the public drive's root and ordinary folders belong to every
 * member, who may list them and create, rename or delete folders in them. Two
 * kinds of folder are carved out of that, and both are environment
 * directories:
 *
 * - **Read-only** — every environment directory. It is the saved copy of a
 *   sandbox's work tree, written by its own sessions alone: a write from
 *   outside would be overwritten by the next save, or leave the folder
 *   disagreeing with the record the next restore reads it by. Moving or
 *   deleting a folder that holds one is the same write.
 * - **Hidden** — a private environment's directory on the public drive. New
 *   ones are made on their owner's personal drive; these are left over from
 *   before members had one, and their home directory can hold the owner's
 *   credentials. Until they are rebuilt they are left out of every listing
 *   and refused when named, for everyone, exactly as if they were not there.
 *
 * With an instance the route is confined to that instance's directory, read
 * only, and goes to the drive the instance is on.
 */
interface DriveScope {
  /** The client of the drive this scope is on. */
  client: SandboxStorageClient;
  /** Legacy private environment directories nobody may see; see above. */
  hidden: string[];
  /** Every environment directory on the drive. */
  instanceDirectories: string[];
  /** Where a route is confined; `''` is the whole drive. */
  root: string;
}

interface DriveContext {
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
const resolveInstanceDrive = async (
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
const assertNotLeftOnPublicDrive = async (
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
const isPublicDrive = (ctx: Pick<DriveContext, 'drive' | 'workspaceId'>) =>
  !!ctx.workspaceId && ctx.drive === 'public';

const resolveDriveScope = async (ctx: DriveContext, instanceId?: string): Promise<DriveScope> => {
  if (instanceId) {
    const instance = await ctx.instanceModel.findById(instanceId);
    if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
    const { client } = await resolveInstanceDrive(ctx, instance);

    return {
      client,
      hidden: [],
      instanceDirectories: [instance.workingDirectory],
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
    instanceDirectories: directories.map((entry) => entry.workingDirectory),
    root: '',
  };
};

/** Whether `path` is `root` itself or somewhere beneath it. */
const isWithinRoot = (path: string, root: string) => !root || isPathWithin(path, root);

const isHidden = (path: string, scope: DriveScope) =>
  scope.hidden.some((directory) => isPathWithin(path, directory));

const assertReadable = (path: string, scope: DriveScope) => {
  if (!isWithinRoot(path, scope.root)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'PATH_OUTSIDE_INSTANCE' });
  }
  // The same answer a path that does not exist gets: a folder this member may
  // not see is not one they get to learn about by guessing its name.
  if (isHidden(path, scope)) throw new TRPCError({ code: 'NOT_FOUND', message: 'PATH_NOT_FOUND' });
};

/**
 * Refuses a write into an environment directory, and a move or delete of a
 * folder holding one. Refused before anything is looked up when an instance
 * is named: the answer is the same whether or not the instance exists.
 */
const resolveWritableScope = async (
  ctx: DriveContext,
  { instanceId, path }: { instanceId?: string; path: string },
) => {
  if (instanceId) throw new TRPCError({ code: 'FORBIDDEN', message: 'INSTANCE_READ_ONLY' });

  const scope = await resolveDriveScope(ctx);
  assertReadable(path, scope);
  if (
    scope.instanceDirectories.some(
      (directory) => isPathWithin(path, directory) || isPathWithin(directory, path),
    )
  ) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'INSTANCE_READ_ONLY' });
  }

  return scope;
};

/** Names the instance a file route works in; see {@link resolveDriveScope}. */
const instanceIdSchema = idSchema.optional();

/**
 * The drive an environment's directories are made on: a private environment's
 * on its owner's personal drive, a published one's on the public drive every
 * member can run it from. A personal account has the one drive.
 */
const driveForEnvironment = (
  environment: { visibility?: string | null; workspaceId?: string | null },
  workspaceId?: string | null,
): SandboxDrive => {
  if (!workspaceId) return 'personal';

  return environment.workspaceId && environment.visibility === 'private' ? 'personal' : 'public';
};

export const sandboxStorageRouter = router({
  /**
   * Create a folder, parents included. Idempotent — an existing folder is a
   * success, so a picker can offer "new folder" without first proving the
   * name is free.
   */
  createDirectory: instanceProcedure
    .input(
      z.object({
        drive: driveSchema,
        instanceId: instanceIdSchema,
        path: relativePathSchema,
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input: { drive: _drive, instanceId, ...input } }) => {
      const scope = await resolveWritableScope(ctx, { instanceId, path: input.path });

      const created = await scope.client.createDirectory(input).catch(mapStorageError);
      forgetDriveFolders(ctx.claim.key);

      return created;
    }),

  /**
   * Whether this caller has a persistent workspace at all. The client pairs it
   * with the lab flag it already holds: flag off renders nothing, flag on
   * without an entitlement renders the upgrade prompt, and both renders the
   * workspace.
   */
  getEntitlement: storageClaimProcedure.query(async ({ ctx }) => ({
    /**
     * The drives this caller has: `public` and `personal` in a workspace,
     * `personal` alone in a personal account. Both of a workspace's drive
     * share one plan, so one is entitled exactly when the other is.
     */
    drives: ctx.drives.available,
    entitled: Boolean(ctx.claim),
    quotaBytes: ctx.claim?.quotaBytes ?? null,
  })),

  /**
   * Where this topic's commands will run, for the prompt that describes it.
   *
   * The browser assembles the system role on the client-executor path, and it
   * cannot resolve this itself: the placement follows an entitlement that is
   * signed server-side. Without it the prompt fell back to the disposable
   * wording — "files created here are temporary" — while the run had a
   * persistent directory, and the model worked in /tmp on the strength of what
   * it had been told.
   *
   * Returns the placement only. The claim stays on this side; a browser has no
   * use for an entitlement it cannot sign anything with, and every sandbox call
   * it makes is routed through a server that resolves the claim again.
   */
  resolveSessionPlacement: storageClaimProcedure
    .input(z.object({ topicId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { claim, cwd, drive, fallback, mode, workingDir } = await resolveSandboxSessionConfig({
        isShareVisitorRun: false,
        serverDB: ctx.serverDB,
        topicId: input.topicId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      // `fallback` says why a folder or environment directory the topic picked
      // is not where this run goes, so the composer can tell the person
      // before they send rather than after the work went somewhere temporary.
      return claim ? { cwd, drive, fallback, mode, workingDir } : null;
    }),

  /**
   * Fork an instance: a second directory that starts with everything the
   * first one had installed. The point of copying rather than creating is to
   * skip the rebuild — the specification alone would give an empty directory
   * and a fresh bootstrap.
   */
  copyInstance: instanceProcedure
    .input(
      z.object({
        id: idSchema,
        name: nameSchema,
        workingDirectory: instanceDirectorySchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.instanceModel.findOwnedById(input.id);
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
      // Beside the source, on the same drive: the copy starts from the
      // source's snapshot, which lives on that drive's volume.
      const sourceDrive = await resolveInstanceDrive(ctx, source);
      const { claim, client } = sourceDrive;
      await assertNotLeftOnPublicDrive(ctx, source, sourceDrive);
      await assertFolderFree(client, input.workingDirectory);

      // A held instance is mid-write, so a copy would capture a tree halfway
      // through a change. The execution plane refuses it too; asking first
      // keeps the refusal ahead of the row insert and gives it the same code
      // the rest of the client already turns into a sentence. A lease store
      // that did not answer is not read as "free" — here that means refusing,
      // because unlike a rebuild there is no runtime lease standing behind a
      // copy to catch the second writer.
      const occupancy = await client
        .readOccupancy({ names: [source.id] })
        .catch(() => ({ held: [], unavailable: true }));
      if (occupancy.unavailable || occupancy.held.some((entry) => entry.id === source.id)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'INSTANCE_IN_USE' });
      }

      // Row first: a copy whose snapshot succeeded but whose row is missing
      // would be captured state nobody can name, and therefore nobody can
      // delete. The reverse — a row whose snapshot never arrived — is the same
      // state as a brand-new instance, which the UI already handles.
      const created = await ctx.instanceModel
        .create({
          ...sandboxStorageBinding(claim.key),
          // The copy's files are the source's, so its definition is too. Left
          // to default, it would snapshot whatever the environment says now
          // and describe a checkout the copied tree does not contain.
          configurationSnapshot: source.configurationSnapshot,
          environmentId: source.environmentId,
          name: input.name,
          workingDirectory: input.workingDirectory,
        })
        .catch(rethrowDuplicateInstanceDirectory);

      if (!created) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      await client
        .copyInstance({
          from: source.id,
          // The copy's own folder. Sharing the source's would let either
          // instance's next save delete files the other still lists.
          instanceDir: created.workingDirectory,
          to: created.id,
        })
        .catch(async (error) => {
          await ctx.instanceModel.delete(created.id);
          return mapStorageError(error);
        });

      // A copy starts life with everything the source had built, so it is
      // ready by arrival — there is nothing to clone and nothing to install.
      // Left at the insert's default it would sit in `pending` with no build
      // to wait for, which reads as "never built" and offers a rebuild that
      // would throw the copy away.
      await ctx.instanceModel.update(created.id, { status: 'ready' });

      return { ...created, status: 'ready' as const };
    }),

  /**
   * A new instance of an environment, with its directory derived rather than
   * asked for.
   *
   * The person picked an environment, not a folder. Under the agreed split the
   * checkout and its installed packages live on local disk and travel in the
   * snapshot, so this directory holds the outputs worth keeping — which is
   * rarely something anyone has an opinion about before the work exists. Asking
   * would make them invent an answer to start a conversation.
   */
  createInstanceForEnvironment: instanceProcedure
    .input(z.object({ environmentId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      // Owner-scoped: an environment a colleague published is one you can run
      // in, not one you can add copies to.
      const environment = await ctx.environmentModel.findOwnedById(input.environmentId);
      if (!environment)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      const access = await ctx.drives.client(driveForEnvironment(environment, ctx.workspaceId));
      if (!access) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This account has no persistent sandbox workspace',
        });
      }

      return createDerivedInstance(ctx.instanceModel, access.client, access.claim.key, environment);
    }),

  /**
   * Initialize a folder from an environment: an environment directory at the
   * drive's root, with its own captured state. Created unbuilt — the caller
   * starts the build next, the same split as for any other new instance.
   *
   * Only a new folder, or an empty one. Building into a folder that already
   * holds work would mix a checkout into it, and a later rebuild would throw
   * that work away with the old checkout.
   */
  createInstance: instanceProcedure
    .input(
      z.object({
        environmentId: idSchema,
        name: nameSchema,
        workingDirectory: instanceDirectorySchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // The environment decides the drive, not the drive being browsed: a
      // private environment's directory goes on its owner's personal drive,
      // where no other member can reach the home directory it captures.
      const environment = await ctx.environmentModel.findOwnedById(input.environmentId);
      if (!environment)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });
      const drive = driveForEnvironment(environment, ctx.workspaceId);
      const access = await ctx.drives.client(drive);
      if (!access) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This account has no persistent sandbox workspace',
        });
      }

      await assertFolderFree(access.client, input.workingDirectory);

      const created = await ctx.instanceModel
        .create({
          ...sandboxStorageBinding(access.claim.key),
          environmentId: input.environmentId,
          name: input.name,
          workingDirectory: input.workingDirectory,
        })
        .catch(rethrowDuplicateInstanceDirectory);

      if (!created) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });
      forgetDriveFolders(access.claim.key);

      return { ...created, drive };
    }),

  /**
   * Materialize an instance: clone the environment's sources and run its
   * bootstrap, into the instance's own stored generation.
   *
   * Its own mutation rather than part of `createInstance`, because starting a
   * build attaches a sandbox session and that is a cold start — seconds, with
   * a dialog open in front of it. The dialog closes on the insert; the list
   * shows the instance as pending and this is what the client fires next.
   *
   * Returns as soon as the build has started: a bootstrap running an install
   * is minutes long, and `instanceBuildStatus` is what follows it.
   */
  startInstanceBuild: instanceProcedure
    .input(z.object({ id: idSchema, topicId: topicIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.instanceModel.findOwnedById(input.id);
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });
      const instanceDrive = await resolveInstanceDrive(ctx, instance);
      const { client } = instanceDrive;
      await assertNotLeftOnPublicDrive(ctx, instance, instanceDrive);

      // The definition this instance was created from, not the environment's
      // current one: a build has to produce what the instance says it is, and
      // the two differ exactly when the environment moved on.
      const specification = instance.configurationSnapshot;
      const buildable = isBuildable(specification);

      // An environment that clones nothing and installs nothing is already
      // everything it is ever going to be. Building it would cold-start a
      // sandbox to do nothing and leave an empty archive behind.
      if (!buildable) {
        await ctx.instanceModel.update(input.id, { status: 'ready' });

        return { buildId: null };
      }

      // A rebuild replaces the folder a conversation may be writing in right
      // now, so a held instance is refused before the row changes at all. A
      // lease store that did not answer is not read as "free" — the runtime's
      // own lease still stands behind this and refuses a second writer.
      const occupancy = await client
        .readOccupancy({ names: [input.id], topicId: input.topicId })
        .catch(() => ({ held: [], unavailable: true }));
      if (occupancy.held.some((entry) => entry.id === input.id)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'INSTANCE_IN_USE' });
      }

      // What to fall back to if the build never starts. An instance that was
      // ready still has everything its last build published — a refused start
      // takes none of it away, so it must not come back reading "failed".
      const previousStatus = instance.status;

      await ctx.instanceModel.update(input.id, { buildError: null, status: 'pending' });

      // Preferred over the execution plane's own GitHub connection, which it
      // falls back to when this answers null: an App installation is granted
      // one repository at a time by whoever administers the account, and the
      // token minted from it is narrower still — this repository, read-only,
      // expiring within the hour. It is resolved here because the App's
      // private key lives on this side; the execution plane is handed the
      // result and never the inputs, the same way it is handed the workspace
      // claim.
      const credential = await resolveScmCloneCredential({
        configuration: specification,
        db: ctx.serverDB,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      try {
        const { buildId } = await client.buildInstance({
          credentials: credential ? [credential] : undefined,
          // Where the checkout lands on the volume: the instance's own folder,
          // which is what its file browser opens.
          instanceDir: instance.workingDirectory,
          name: input.id,
          // Without the product's own fields: the execution plane digests
          // what it is sent, and an instance created before `kind` existed
          // must keep matching the build it already has.
          specification: toExecutionConfiguration(specification),
          topicId: input.topicId,
        });
        await ctx.instanceModel.update(input.id, { buildId });

        return { buildId };
      } catch (error) {
        // Recorded on the row rather than only thrown: the client that asked
        // may already be gone, and an instance left saying "pending" forever
        // is the one state nothing recovers from.
        await ctx.instanceModel.update(
          input.id,
          previousStatus === 'ready'
            ? { status: 'ready' }
            : {
                buildError: (error as Error)?.message || 'Could not start the build',
                status: 'error',
              },
        );
        throw error;
      }
    }),

  /**
   * Follow a build, and settle the instance once it ends.
   *
   * A query that writes, deliberately: the runtime is the only thing that
   * knows a build finished, nothing calls back, and the row has to end up
   * right whether or not anyone is still watching. Polling it is what moves
   * the instance out of `pending`.
   */
  instanceBuildStatus: instanceProcedure
    .input(
      z.object({
        id: idSchema,
        /** Resume the log from here; the reply says where to go next. */
        logOffset: z.number().int().min(0).optional(),
        topicId: topicIdSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const instance = await ctx.instanceModel.findById(input.id);
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      if (!instance.buildId) {
        return {
          chunk: '',
          logOffset: input.logOffset ?? 0,
          state: instance.status === 'error' ? ('failed' as const) : ('idle' as const),
        };
      }

      const { client } = await resolveInstanceDrive(ctx, instance);
      const status = await client
        .buildStatus({
          buildId: instance.buildId,
          logOffset: input.logOffset,
          name: input.id,
          topicId: input.topicId,
        })
        .catch(mapStorageError);

      if (status.state !== 'running') {
        // The id is cleared with the verdict: the runtime drops a finished
        // build's log on its own schedule, and an id that outlives it has the
        // UI polling for a log that will never come back. Written through the
        // visibility-scoped recorder, because the poll that happens to receive
        // the terminal status can be a viewer's rather than the owner's.
        await ctx.instanceModel.recordBuildResult(input.id, instance.buildId, {
          buildError:
            status.state === 'failed' ? status.chunk.slice(-2000) || 'Build failed' : null,
          status: status.state === 'succeeded' ? 'ready' : 'error',
        });
      }

      return { chunk: status.chunk, logOffset: status.logOffset, state: status.state };
    }),

  /**
   * One instance, from the database alone. Separate from `listInstances`
   * because the composer only needs to know where the conversation is pointed,
   * and `listInstances` pays a sandbox cold start to answer how big everything
   * is — seconds, for a label.
   */
  getInstance: instanceProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
    const instance = await ctx.instanceModel.findById(input.id);
    if (!instance) return null;

    // Which of the caller's drives it is on, for the composer's label —
    // `null` on a drive that is not theirs, which the run refuses.
    return { ...instance, drive: ctx.drives.driveOf(instance.providerScope) ?? null };
  }),

  // A topic stands for the drive it picked, so the working panel's tree is
  // rooted on the drive its files are actually on.
  getStorage: entitledProcedure
    .input(z.object({ drive: driveSchema, topicId: topicIdSchema }).optional())
    .query(async ({ ctx }) => ctx.client.getStorage().catch(mapStorageError)),

  /**
   * How much each of the caller's drives holds against the plan's quota.
   *
   * A workspace's public drive and every member's personal drive draw on one
   * pool, so the figure that decides whether a write is refused is their sum
   * — the execution plane reports it beside each drive's own. An owner or
   * admin is also shown how much each other member's personal drive holds:
   * the amount, which is the workspace's to pay for, and never the contents,
   * which stay out of reach of every claim this router issues.
   */
  getDriveUsage: entitledProcedure.query(async ({ ctx }) =>
    readDriveUsage({
      claim: ctx.claim,
      drives: ctx.drives,
      role: (ctx as { workspaceRole?: WorkspaceRole }).workspaceRole,
      serverDB: ctx.serverDB,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId ?? undefined,
    }),
  ),

  refreshStorageUsage: entitledProcedure
    .input(z.object({ drive: driveSchema }).optional())
    .mutation(async ({ ctx }) => ctx.client.refreshUsage().catch(mapStorageError)),

  /**
   * Instances, each joined with the state the execution plane actually
   * holds for it. An instance that was created but never used has no snapshot
   * yet, which is a normal state and not an error.
   */
  listInstances: instanceProcedure
    .input(
      z.object({
        /**
         * Only the instances on this drive — what a picker browsing one drive
         * asks for. Without it, every instance on any of the caller's drives,
         * which is what the environments page lists.
         */
        drive: driveSchema,
        environmentId: idSchema.optional(),
        topicId: topicIdSchema,
        /**
         * Sizes come from the snapshot store, which is reachable only through a
         * sandbox session and pays a cold start to answer. A settings page is
         * worth that wait; a picker in the composer is not, and asks for names
         * alone.
         */
        withSizes: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      // An instance on a drive that is not the caller's — a colleague's
      // personal drive, under an environment they have since published — is
      // not one the caller can run in, list the files of, or size.
      const located = (await ctx.instanceModel.query({ environmentId: input.environmentId }))
        .map((instance) => ({ drive: ctx.drives.driveOf(instance.providerScope), instance }))
        .filter(
          (entry): entry is { drive: SandboxDrive; instance: typeof entry.instance } =>
            !!entry.drive && (!input.drive || entry.drive === ctx.drive),
        );
      const instances = located.map((entry) => entry.instance);
      const driveById = new Map(located.map((entry) => [entry.instance.id, entry.drive]));

      // Private environments' directories left on the public drive: listed
      // for their owner — the only member who sees a private environment —
      // with the instruction to rebuild them, and run by nobody.
      const publicAccess =
        ctx.workspaceId && located.some((entry) => entry.drive === 'public')
          ? await ctx.drives.client('public')
          : undefined;
      const rebuildRequired = new Set(
        publicAccess
          ? (
              await ctx.instanceModel.listStorageDirectories(
                sandboxStorageBinding(publicAccess.claim.key),
              )
            )
              .filter((entry) => entry.isPrivate)
              .map((entry) => entry.id)
          : [],
      );

      // One client per drive, since each drive's snapshots and leases are
      // read through a claim for that drive.
      const drives = [...new Set(located.map((entry) => entry.drive))];
      const perDrive = await pMap(
        drives,
        async (drive) => {
          const access = await ctx.drives.client(drive);
          const names = located
            .filter((entry) => entry.drive === drive)
            .map((entry) => entry.instance.id);

          const [snapshots, occupancy] = await Promise.all([
            input.withSizes && access
              ? access.client
                  .listInstances({ topicId: input.topicId })
                  .then((result) => result.instances)
                  // If the store fails, the instances still exist and can
                  // still be renamed or selected — only their sizes are
                  // unknown, so say so rather than failing a settings page.
                  .catch(() => null)
              : input.withSizes
                ? null
                : [],
            // Always, and separately from the sizes: this is a Redis read on
            // the control plane, so it costs the same on every deployment,
            // whereas the listing above opens the volume. An instance held by
            // another conversation cannot be run in — the lease answers the
            // second writer with a 409 — so a picker that does not know is a
            // picker that offers a choice the first message will refuse.
            access && names.length > 0
              ? access.client
                  .readOccupancy({ names, topicId: input.topicId })
                  // Same rule the lease store itself follows: a failure is
                  // "not known", never "free".
                  .catch(() => ({ held: [], unavailable: true }))
              : { held: [], unavailable: !access && names.length > 0 },
          ]);

          return { access, drive, occupancy, snapshots };
        },
        { concurrency: 5 },
      );
      const clientByDrive = new Map(
        perDrive.flatMap((entry) => (entry.access ? [[entry.drive, entry.access.client]] : [])),
      );

      // A build is polled by whoever has the Instances tab open, and nobody
      // has it open most of the time — switch tabs mid-build and the verdict
      // never lands, leaving the row `pending` against a build the runtime
      // has since discarded and an instance the composer will not offer. So
      // every listing settles the builds it finds already finished. Bounded
      // by how many instances can be building at once, and never fatal: an
      // unreachable execution plane just leaves the row as it was.
      const settled = await pMap(
        instances.filter((instance) => instance.buildId),
        async (instance) => {
          const client = clientByDrive.get(driveById.get(instance.id)!);
          if (!client) return null;
          const status = await client
            .buildStatus({ buildId: instance.buildId!, name: instance.id, topicId: input.topicId })
            .catch(() => null);
          if (!status || status.state === 'running') return null;

          const next = {
            buildError:
              status.state === 'failed' ? status.chunk.slice(-2000) || 'Build failed' : null,
            status: status.state === 'succeeded' ? ('ready' as const) : ('error' as const),
          };
          await ctx.instanceModel
            .recordBuildResult(instance.id, instance.buildId!, next)
            .catch(() => undefined);

          return [instance.id, next] as const;
        },
        { concurrency: 5 },
      );
      const settledById = new Map(settled.filter((entry) => !!entry));

      const byId = new Map(
        perDrive.flatMap((entry) =>
          (entry.snapshots ?? []).map((snapshot) => [snapshot.id, snapshot] as const),
        ),
      );
      const heldBy = new Map(
        perDrive.flatMap((entry) => entry.occupancy.held.map((held) => [held.id, held.own])),
      );

      return {
        instances: instances.map((instance) => ({
          /** Set only while a build is worth polling; cleared with its verdict. */
          buildId: settledById.has(instance.id) ? null : instance.buildId,
          // From the definition the instance was made from, which is what a
          // build uses — the environment may have moved on since.
          buildable: isBuildable(instance.configurationSnapshot),
          buildError: settledById.get(instance.id)?.buildError ?? instance.buildError,
          createdAt: instance.createdAt,
          /** Which of the caller's drives the directory is on. */
          drive: driveById.get(instance.id)!,
          environmentId: instance.environmentId,
          id: instance.id,
          // Held by a running sandbox, and by whom. `own` is this topic's own
          // run, which its own picker must keep offering; anything else is
          // another conversation and is what a picker refuses.
          inUse: heldBy.has(instance.id),
          inUseByThisTopic: heldBy.get(instance.id) === true,
          name: instance.name,
          /**
           * A private environment's directory on the public drive, from
           * before members had drives of their own: hidden there, never run
           * in, and to be initialized again on the owner's personal drive.
           */
          rebuildRequired: rebuildRequired.has(instance.id),
          snapshot: byId.get(instance.id) ?? null,
          status: settledById.get(instance.id)?.status ?? instance.status,
          workingDirectory: instance.workingDirectory,
        })),
        occupancyUnavailable: perDrive.some((entry) => entry.occupancy.unavailable),
        snapshotsUnavailable: perDrive.some((entry) => entry.snapshots === null),
      };
    }),

  /**
   * The run history of every instance of one environment, newest first.
   *
   * The execution plane keys its trail by instance — that is the name the
   * snapshot is stored under — while the panel shows one environment, so this
   * is the union of the instances' histories with the instance named on each
   * row. Read from the control plane's own records: unlike `listInstances`
   * it starts no sandbox and pays no cold start.
   *
   * Topic titles are looked up for the caller's own topics; a run another
   * member started in a published environment keeps its id only.
   */
  listInstanceSessions: instanceProcedure
    .input(
      z.object({
        environmentId: idSchema,
        /** Per instance, not in total: each instance's page is fetched on its own. */
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const instances = (
        await ctx.instanceModel.query({ environmentId: input.environmentId })
      ).filter((instance) => ctx.drives.driveOf(instance.providerScope));
      if (instances.length === 0) return { sessions: [], unavailable: false };

      // Bounded: an environment's instance count is whatever the member made,
      // and one request per instance all at once would put that number on the
      // execution plane in a single burst.
      const pages = await pMap(
        instances,
        (instance) =>
          resolveInstanceDrive(ctx, instance)
            .then(({ client }) =>
              client.listEnvironmentSessions({ limit: input.limit, name: instance.id }),
            )
            // One instance's history failing must not blank the others; the
            // caller is told the list is incomplete rather than shown "no runs".
            .catch(() => null),
        { concurrency: 5 },
      );

      const merged = instances
        .flatMap((instance, index) =>
          (pages[index]?.sessions ?? []).map((session) => ({
            ...session,
            instanceId: instance.id,
            instanceName: instance.name,
          })),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

      const topicIds = [
        ...new Set(
          merged
            .map((session) => session.topicId)
            .filter((id): id is string => !!id && id !== MANAGEMENT_TOPIC_ID),
        ),
      ];
      // Read in the workspace's scope — the personal scope matches no
      // workspace topic at all — and then narrowed to the caller's own, since
      // a workspace scope also reaches what other members may see.
      const topics =
        topicIds.length > 0
          ? await new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined)
              .findByIds(topicIds)
              .catch(() => [])
          : [];
      // Where the conversation lives, as well as what it is called: a topic is
      // addressed as `group/<groupId>/<topicId>` when it belongs to a group and
      // `agent/<agentId>/<topicId>` otherwise, so a link built from the topic
      // alone cannot resolve and the panel's one way back into the run is a 404.
      // A group topic carries BOTH ids, which is why the group one is returned
      // rather than inferred from the absence of an agent.
      const topicInfo = new Map(
        topics
          .filter((topic) => topic.userId === ctx.userId)
          .map((topic) => [
            topic.id,
            { agentId: topic.agentId, groupId: topic.groupId, title: topic.title },
          ]),
      );

      return {
        sessions: merged.map((session) => {
          const info = session.topicId ? topicInfo.get(session.topicId) : undefined;

          return {
            ...session,
            topicAgentId: info?.agentId ?? null,
            topicGroupId: info?.groupId ?? null,
            topicTitle: info?.title || null,
          };
        }),
        unavailable: pages.includes(null),
      };
    }),

  /**
   * One folder's entries — or, with `recursive`, everything under it — with
   * the private environment directories left on the public drive left out.
   *
   * No path means "where this conversation works" when a topic is named and
   * it has a folder or an environment directory, and the drive's root
   * otherwise: the file panel asks the first question, the directory picker
   * the second.
   */
  listFiles: instanceProcedure
    .input(
      z.object({
        drive: driveSchema,
        instanceId: instanceIdSchema,
        path: relativePathSchema.optional(),
        recursive: z.boolean().optional(),
        topicId: topicIdSchema,
      }),
    )
    .query(async ({ ctx, input: { drive: _drive, instanceId, ...input } }) => {
      let scope = await resolveDriveScope(ctx, instanceId);

      let path = input.path ?? (scope.root || undefined);
      if (path === undefined && input.topicId && !instanceId) {
        const placement = await resolveSandboxSessionConfig({
          isShareVisitorRun: false,
          serverDB: ctx.serverDB,
          topicId: input.topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        if (placement.mode !== 'ephemeral') {
          path = placement.cwd;
          // The conversation's folder is on the drive it resolved to — an
          // environment directory's own drive, say — which is not
          // necessarily the one this call was routed by.
          if (placement.drive !== ctx.drive) {
            const access = await ctx.drives.client(placement.drive);
            if (access) {
              scope = await resolveDriveScope({
                ...ctx,
                claim: access.claim,
                client: access.client,
                drive: placement.drive,
              });
            }
          }
        }
      }
      if (path !== undefined) assertReadable(path, scope);

      const listing = await scope.client.listFiles({ ...input, path }).catch(mapStorageError);
      if (scope.hidden.length === 0) return listing;

      return {
        ...listing,
        entries: listing.entries.filter((entry) => !isHidden(entry.path, scope)),
      };
    }),

  readFile: instanceProcedure
    .input(
      z.object({
        drive: driveSchema,
        instanceId: instanceIdSchema,
        path: relativePathSchema,
        topicId: topicIdSchema,
      }),
    )
    .query(async ({ ctx, input: { drive: _drive, instanceId, ...input } }) => {
      const scope = await resolveDriveScope(ctx, instanceId);
      assertReadable(input.path, scope);

      return scope.client.readFile(input).catch(mapStorageError);
    }),

  /**
   * Rename or move a file or folder. Never overwrites: a destination that is
   * already there is refused, and so is anything touching an environment
   * directory — at either end.
   */
  renameFile: instanceProcedure
    .input(
      z.object({
        drive: driveSchema,
        newPath: relativePathSchema,
        path: relativePathSchema,
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input: { drive: _drive, ...input } }) => {
      const scope = await resolveWritableScope(ctx, { path: input.path });
      await resolveWritableScope(ctx, { path: input.newPath });

      const renamed = await scope.client.renameFile(input).catch(mapStorageError);
      forgetDriveFolders(ctx.claim.key);

      return renamed;
    }),

  /**
   * Write a file's whole contents, creating it and its parents if needed.
   *
   * Text only, because the execution plane's endpoint carries the body as a
   * JSON string with no encoding field. The cap is this layer's own: the
   * endpoint declares none, and an unbounded string arrives in memory on both
   * sides before anything touches a disk.
   */
  writeFile: instanceProcedure
    .input(
      z.object({
        content: fileContentSchema,
        drive: driveSchema,
        instanceId: instanceIdSchema,
        path: relativePathSchema,
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input: { drive: _drive, instanceId, ...input } }) => {
      const scope = await resolveWritableScope(ctx, { instanceId, path: input.path });

      return scope.client.writeFile(input).catch(mapStorageError);
    }),

  /**
   * Remove an environment directory: what its builds left on the drive, and
   * the row. Any of them, the first included — an environment owns no folder
   * of its own any more, so none is left to stand for it.
   */
  removeInstance: instanceProcedure
    .input(z.object({ id: idSchema, topicId: topicIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.instanceModel.findOwnedById(input.id);
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      // Snapshot first, and only drop the row once it is gone: a row removed
      // while the snapshot survives leaves storage nobody can see, name, or
      // reclaim. The execution plane refuses while a session is using it, and
      // that refusal is the one the user needs to see.
      const { claim, client } = await resolveInstanceDrive(ctx, instance);
      await deleteInstanceSnapshot(client, instance.id, input.topicId);
      forgetDriveFolders(claim.key);

      return ctx.instanceModel.delete(input.id);
    }),

  /**
   * End the run holding an instance, so it can be picked, rebuilt or deleted
   * now instead of after the idle sweep.
   *
   * The owner's, like a rebuild or a delete: in a published environment the
   * run holding the instance is usually a colleague's conversation, and
   * cutting it off is not something reading access should allow. The
   * execution plane does the stop properly — snapshot first, lease released
   * only once the stop is confirmed — and its refusals (still saving, still
   * starting, being built) travel as codes the client turns into sentences.
   */
  stopInstance: instanceProcedure
    .input(z.object({ id: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.instanceModel.findOwnedById(input.id);
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      const { client } = await resolveInstanceDrive(ctx, instance);

      return client.stopInstance({ name: instance.id }).catch(mapStorageError);
    }),

  removeFile: instanceProcedure
    .input(
      z.object({
        drive: driveSchema,
        instanceId: instanceIdSchema,
        path: relativePathSchema,
        recursive: z.boolean().optional(),
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input: { drive: _drive, instanceId, ...input } }) => {
      const scope = await resolveWritableScope(ctx, { instanceId, path: input.path });

      const removed = await scope.client.deleteFile(input).catch(mapStorageError);
      forgetDriveFolders(ctx.claim.key);

      return removed;
    }),

  renameInstance: instanceProcedure
    .input(z.object({ id: idSchema, name: nameSchema }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      const updated = await ctx.instanceModel.update(id, changes);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      return updated;
    }),
});

export type SandboxStorageRouter = typeof sandboxStorageRouter;
