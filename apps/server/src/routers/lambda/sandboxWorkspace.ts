import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';
import { ConnectorDataError } from '@lobechat/connector-data';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { EnvironmentModel } from '@/database/models/environment';
import { EnvironmentInstanceModel } from '@/database/models/environmentInstance';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ConnectorDataService } from '@/server/services/connectorData';
import { MarketService } from '@/server/services/market';
import { resolveSandboxWorkspaceClaim } from '@/server/services/sandbox';
import { SandboxWorkspaceFilesError } from '@/server/services/sandbox/workspaceFiles';

/**
 * Browsing and managing the persistent sandbox workspace.
 *
 * The workspace lives on a volume mounted into the sandbox runtime, so every
 * call here runs inside a sandbox session on the caller's behalf. Paths are
 * always relative to the workspace root; the absolute mount path never reaches
 * a client, which leaves nothing for one to smuggle back.
 */

/** Relative workspace path, validated with the same rule the runtime applies. */
const relativePathSchema = z.string().refine(isSafeSandboxCwd, {
  message: 'Path must be a relative path inside the workspace',
});

/**
 * Topic whose warm sandbox session should serve the call, so listing a
 * directory does not cold-start a second sandbox next to the one the user is
 * already talking to.
 */
const topicIdSchema = z.string().min(1).max(255).optional();

/**
 * Ceiling on a single write. Generous for anything a person edits by hand and
 * small enough that a runaway body is refused before it is buffered — this is
 * an editor's save path, not a bulk upload.
 */
const MAX_FILE_CONTENT_BYTES = 1024 * 1024;

/**
 * "You have not connected GitHub" travels as an error from the connector layer,
 * but for the picker it is an answer, not a failure — the one it is there to
 * help the user fix.
 */
const isGithubUnavailable = (error: unknown): boolean =>
  error instanceof ConnectorDataError && error.provider === 'github' && !error.retryable;

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

const mapWorkspaceError = (error: unknown): never => {
  if (error instanceof SandboxWorkspaceFilesError) {
    throw new TRPCError({
      code: WORKSPACE_ERROR_CODES[error.status] ?? 'BAD_GATEWAY',
      message: error.message,
    });
  }

  throw error;
};

// The caller is always acting as themselves here — this is a signed-in user
// browsing their own workspace, not an agent run executing under someone
// else's identity — so there is no share-visitor case to suppress.
const workspaceProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  const claim = await resolveSandboxWorkspaceClaim({
    isShareVisitorRun: false,
    serverDB: ctx.serverDB,
    userId: ctx.userId,
    workspaceId,
  });

  return opts.next({
    ctx: {
      claim,
      marketService: new MarketService({
        userInfo: { sandboxWorkspace: claim, userId: ctx.userId, workspaceId },
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
const entitledProcedure = workspaceProcedure.use(async (opts) => {
  const { claim, marketService } = opts.ctx;
  if (!claim) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This account has no persistent sandbox workspace',
    });
  }

  return opts.next({ ctx: { claim, client: marketService.getSandboxWorkspaceClient() } });
});

/**
 * A user-facing environment name. Distinct from the row's id, which is what the
 * execution plane stores the snapshot under and never changes — this is the
 * part a rename is allowed to move.
 */
const nameSchema = z.string().trim().min(1).max(255);

/**
 * An environment or instance id. Checked for shape rather than left to the
 * lookup, because the lookup cannot answer: a non-UUID compared against a
 * `uuid` column is a Postgres type error, so the caller would get a server
 * fault where "no such environment" was the answer.
 *
 * An instance's id doubles as the name its snapshot is stored under, which is
 * why it never changes.
 */
const idSchema = z.string().uuid();

/**
 * Who an environment resolves for inside a workspace. Personal environments
 * have no pool to join, so the server stores `private` for them whatever a
 * client sends.
 */
const visibilitySchema = z.enum(['private', 'public']);

/** The indexes that make a name identify one environment for one member. */
const ENVIRONMENT_NAME_CONSTRAINTS = new Set([
  'environments_user_name_unique',
  'environments_workspace_user_name_unique',
]);

/** The index that keeps two instances out of the same directory. */
const INSTANCE_DIRECTORY_CONSTRAINT = 'environment_instances_provider_path_unique';

/**
 * Where source material comes from. Only `git` for now, and only over HTTPS:
 * the other transports authenticate with a key, and a specification that
 * carries no credentials cannot present one. Private repositories are a
 * separate problem, not a URL scheme.
 */
const environmentSourceSchema = z.object({
  kind: z.literal('git'),
  /** Where the checkout lands, relative to the instance's own directory. */
  path: relativePathSchema.optional(),
  ref: z.string().trim().min(1).max(255).optional(),
  url: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://'), {
      message: 'Only https:// git URLs are supported',
    }),
});

/**
 * Non-secret values only. Enforced by shape as far as a shape can: the name has
 * to look like an environment variable, and the rest is said plainly in the UI
 * and in the type. A field that stores what the user types cannot tell a region
 * from a token, which is why secrets are resolved at use time instead.
 */
const environmentEnvSchema = z.record(
  z
    .string()
    .max(128)
    .regex(/^[A-Z_]\w*$/i, 'Must be a valid environment variable name'),
  z.string().max(4096),
);

const configurationSchema = z.object({
  bootstrapCommand: z.string().max(8000).optional(),
  env: environmentEnvSchema.optional(),
  excludePaths: z.array(relativePathSchema).max(64).optional(),
  internetAccess: z.boolean().optional(),
  maintenanceCommand: z.string().max(8000).optional(),
  // One repository per environment. The wire format stays a list because the
  // execution plane checks out an array of sources, but an environment that
  // builds from two repositories has no single working directory to hand a
  // conversation — and the picker that fills this offers exactly one.
  sources: z.array(environmentSourceSchema).max(1).optional(),
});

/** Postgres surfaces the driver error somewhere down the `cause` chain. */
const getPostgresErrorField = (error: unknown, field: string): string | undefined => {
  let current: unknown = error;

  while (current && typeof current === 'object') {
    const value = (current as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;

    current = (current as { cause?: unknown }).cause;
  }
};

/**
 * The name is the one thing the person chose, and a collision is fixed by
 * typing a different one — so it has to arrive as CONFLICT next to the field,
 * not as the generic failure a raw driver error would produce. A code rather
 * than prose because this one is shown inline and has to be translated.
 */
const rethrowDuplicateEnvironmentName = (error: unknown): never => {
  if (
    getPostgresErrorField(error, 'code') === '23505' &&
    ENVIRONMENT_NAME_CONSTRAINTS.has(getPostgresErrorField(error, 'constraint') ?? '')
  ) {
    throw new TRPCError({ cause: error, code: 'CONFLICT', message: 'DUPLICATE_ENVIRONMENT_NAME' });
  }

  throw error;
};

/**
 * Two instances in one directory would restore two package sets over each
 * other's files, so the database refuses it and the person picks another
 * directory. Same reasoning as a duplicate name, different fix.
 */
const isDuplicateInstanceDirectory = (error: unknown): boolean =>
  getPostgresErrorField(error, 'code') === '23505' &&
  getPostgresErrorField(error, 'constraint') === INSTANCE_DIRECTORY_CONSTRAINT;

const rethrowDuplicateInstanceDirectory = (error: unknown): never => {
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
 * How many derived directories to try before giving up.
 *
 * A bound rather than a loop until success: the only way to exhaust it is a
 * member who already holds fifty directories under one name, and at that point
 * the honest answer is to say so rather than keep probing the index.
 */
const MAX_DERIVED_DIRECTORY_ATTEMPTS = 50;

/**
 * A directory name derived from an environment's name.
 *
 * Letters and digits of any script survive — a Chinese environment name should
 * not become a row of dashes — while everything else collapses to `-`, because
 * this name is handed to a shell as a path. Interior spaces are legal in a
 * workspace path and still not worth minting: every command the agent writes
 * would need to quote them.
 *
 * Leading dots are stripped rather than escaped, which also puts `.sandbox`
 * (the reserved platform directory) out of reach without naming it here.
 */
export const environmentDirectorySlug = (name: string): string => {
  const slug = name
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}._-]+/gu, '-')
    .slice(0, 48)
    .replaceAll(/^[.-]+|[.-]+$/g, '');

  // Every character was punctuation, or the name was dots. Nothing is derivable
  // from it, so fall back to a word rather than to an empty path.
  return slug || 'environment';
};

/**
 * An environment with instances still on it. The reference is `restrict`
 * on purpose — deleting the specification out from under them would leave
 * directories and captured state nothing describes.
 */
const rethrowEnvironmentInUse = (error: unknown): never => {
  if (getPostgresErrorField(error, 'code') === '23503') {
    throw new TRPCError({ cause: error, code: 'CONFLICT', message: 'ENVIRONMENT_HAS_INSTANCES' });
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

/**
 * Where an instance lives, in the vocabulary `environment_instances` uses
 * for every execution target it supports.
 *
 * The scope is the caller's workspace key and the resource is the one
 * persistent workspace inside it — there is exactly one, which is why the
 * resource is named rather than identified. What distinguishes two instances is
 * the directory, and `environment_instances_provider_path_unique` covers that
 * tuple, so the database is what stops two copies landing in one folder.
 */
const sandboxBinding = (workspaceKey: string) => ({
  deviceId: null,
  kind: 'sandbox' as const,
  provider: 'market',
  providerResourceId: 'workspace',
  providerScope: workspaceKey,
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

export const sandboxWorkspaceRouter = router({
  createDirectory: entitledProcedure
    .input(z.object({ path: relativePathSchema, topicId: topicIdSchema }))
    .mutation(async ({ ctx, input }) => ctx.client.createDirectory(input).catch(mapWorkspaceError)),

  /**
   * Whether this caller has a persistent workspace at all. The client pairs it
   * with the lab flag it already holds: flag off renders nothing, flag on
   * without an entitlement renders the upgrade prompt, and both renders the
   * workspace.
   */
  getEntitlement: workspaceProcedure.query(async ({ ctx }) => ({
    entitled: Boolean(ctx.claim),
    quotaBytes: ctx.claim?.quotaBytes ?? null,
  })),

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
        workingDirectory: relativePathSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.instanceModel.findOwnedById(input.id);
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      // Row first: a copy whose snapshot succeeded but whose row is missing
      // would be captured state nobody can name, and therefore nobody can
      // delete. The reverse — a row whose snapshot never arrived — is the same
      // state as a brand-new instance, which the UI already handles.
      const created = await ctx.instanceModel
        .create({
          ...sandboxBinding(ctx.claim.key),
          environmentId: source.environmentId,
          name: input.name,
          workingDirectory: input.workingDirectory,
        })
        .catch(rethrowDuplicateInstanceDirectory);

      if (!created) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      await ctx.client.copyEnvironment({ from: source.id, to: created.id }).catch(async (error) => {
        await ctx.instanceModel.delete(created.id);
        return mapWorkspaceError(error);
      });

      return created;
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
   *
   * The directory is searched rather than computed in one shot: the unique
   * index spans the whole workspace, not one environment, so a name that is
   * free inside this environment can still be taken outside it. The index stays
   * the authority — the pre-check only keeps the common case out of the error
   * path, and a lost race falls through to the next suffix.
   */
  createInstanceForEnvironment: instanceProcedure
    .input(z.object({ environmentId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      // Owner-scoped: an environment a colleague published is one you can run
      // in, not one you can add copies to.
      const environment = await ctx.environmentModel.findOwnedById(input.environmentId);
      if (!environment)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      const base = environmentDirectorySlug(environment.name);

      for (let attempt = 1; attempt <= MAX_DERIVED_DIRECTORY_ATTEMPTS; attempt += 1) {
        const workingDirectory = attempt === 1 ? base : `${base}-${attempt}`;

        if (await ctx.instanceModel.findByWorkingDirectory(workingDirectory)) continue;

        const created = await ctx.instanceModel
          .create({
            ...sandboxBinding(ctx.claim.key),
            environmentId: environment.id,
            // The directory is the only thing that distinguishes this instance
            // from its siblings right now, so it is also the only honest label
            // until the person renames it.
            name: workingDirectory,
            workingDirectory,
          })
          .catch((error: unknown) => {
            // Someone else took this directory between the check and the
            // insert. Not a conflict the caller can act on — try the next one.
            if (isDuplicateInstanceDirectory(error)) return undefined;
            throw error;
          });

        if (created) return created;
      }

      throw new TRPCError({
        code: 'CONFLICT',
        message: 'DUPLICATE_INSTANCE_DIRECTORY',
      });
    }),

  /**
   * An instance of an environment: its own directory, its own captured
   * state. Created empty — nothing is built until a conversation runs in it.
   */
  createInstance: instanceProcedure
    .input(
      z.object({
        environmentId: idSchema,
        name: nameSchema,
        workingDirectory: relativePathSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.instanceModel
        .create({
          ...sandboxBinding(ctx.claim.key),
          environmentId: input.environmentId,
          name: input.name,
          workingDirectory: input.workingDirectory,
        })
        .catch(rethrowDuplicateInstanceDirectory);

      if (!created) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      return created;
    }),

  createEnvironment: environmentProcedure
    .input(
      z.object({
        configuration: configurationSchema.optional(),
        description: z.string().max(2000).optional(),
        name: nameSchema,
        visibility: visibilitySchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.environmentModel.create(input).catch(rethrowDuplicateEnvironmentName),
    ),

  /**
   * One instance, from the database alone. Separate from `listInstances`
   * because the composer only needs to know where the conversation is pointed,
   * and `listInstances` pays a sandbox cold start to answer how big everything
   * is — seconds, for a label.
   */
  getInstance: instanceProcedure
    .input(z.object({ id: idSchema }))
    .query(async ({ ctx, input }) => (await ctx.instanceModel.findById(input.id)) ?? null),

  getWorkspace: entitledProcedure.query(async ({ ctx }) =>
    ctx.client.getWorkspace().catch(mapWorkspaceError),
  ),

  /** Specifications only. Nothing here needs a sandbox session to answer. */
  listEnvironments: environmentProcedure
    .input(z.object({ visibility: visibilitySchema.optional() }).optional())
    .query(async ({ ctx, input }) => ({
      environments: await ctx.environmentModel.query(input?.visibility),
    })),

  /**
   * Instances, each joined with the state the execution plane actually
   * holds for it. An instance that was created but never used has no snapshot
   * yet, which is a normal state and not an error.
   */
  listInstances: instanceProcedure
    .input(
      z.object({
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
      const [instances, snapshots] = await Promise.all([
        ctx.instanceModel.query({ environmentId: input.environmentId }),
        input.withSizes
          ? ctx.client
              .listEnvironments({ topicId: input.topicId })
              .then((result) => result.environments)
              // If the store fails, the instances still exist and can still be
              // renamed or selected — only their sizes are unknown, so say so
              // rather than failing a settings page.
              .catch(() => null)
          : [],
      ]);

      const byId = new Map((snapshots ?? []).map((snapshot) => [snapshot.name, snapshot]));

      return {
        instances: instances.map((instance) => ({
          createdAt: instance.createdAt,
          environmentId: instance.environmentId,
          id: instance.id,
          name: instance.name,
          snapshot: byId.get(instance.id) ?? null,
          // The specification moved after this copy was built, so what is
          // installed here no longer matches what the environment describes.
          // Surfaced rather than repaired: rebuilding discards whatever the
          // conversation installed by hand, and that is the person's call.
          stale: instance.stale,
          workingDirectory: instance.workingDirectory,
        })),
        snapshotsUnavailable: snapshots === null,
      };
    }),

  listFiles: entitledProcedure
    .input(
      z.object({
        path: relativePathSchema.optional(),
        recursive: z.boolean().optional(),
        topicId: topicIdSchema,
      }),
    )
    .query(async ({ ctx, input }) => ctx.client.listFiles(input).catch(mapWorkspaceError)),

  readFile: entitledProcedure
    .input(z.object({ path: relativePathSchema, topicId: topicIdSchema }))
    .query(async ({ ctx, input }) => ctx.client.readFile(input).catch(mapWorkspaceError)),

  /**
   * Write a file's whole contents, creating it and its parents if needed.
   *
   * Text only, because the execution plane's endpoint carries the body as a
   * JSON string with no encoding field. The cap is this layer's own: the
   * endpoint declares none, and an unbounded string arrives in memory on both
   * sides before anything touches a disk.
   */
  writeFile: entitledProcedure
    .input(
      z.object({
        content: z.string().max(MAX_FILE_CONTENT_BYTES),
        path: relativePathSchema,
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.client.writeFile(input).catch(mapWorkspaceError)),

  /** Refused while instances still reference it — those go first. */
  removeEnvironment: environmentProcedure
    .input(z.object({ id: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const removed = await ctx.environmentModel.delete(input.id).catch(rethrowEnvironmentInUse);
      if (!removed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      return removed;
    }),

  removeInstance: instanceProcedure
    .input(z.object({ id: idSchema, topicId: topicIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.instanceModel.findOwnedById(input.id);
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      // Snapshot first, and only drop the row once it is gone: a row removed
      // while the snapshot survives leaves storage nobody can see, name, or
      // reclaim. The execution plane refuses while a session is using it, and
      // that refusal is the one the user needs to see.
      await ctx.client
        .deleteEnvironment({ name: instance.id, topicId: input.topicId })
        .catch((error: unknown) => {
          // No snapshot there is the state this call exists to reach, so a 404
          // is this step succeeding, not failing. An instance nothing has ever
          // run in has nothing on the execution plane — and treating that as an
          // error strands the row permanently, because the environment holding
          // it cannot be deleted either while an instance references it.
          if (error instanceof SandboxWorkspaceFilesError && error.status === 404) return;

          return mapWorkspaceError(error);
        });

      return ctx.instanceModel.delete(input.id);
    }),

  /**
   * Every repository this account can build an environment from, newest
   * activity first, each carrying the owner it belongs to so the caller can
   * group them without a second request per organization.
   *
   * A missing GitHub connection is NOT an error here: it is the state the
   * picker exists to resolve, so it answers `connected: false` and lets the
   * UI offer the connection instead of a failure.
   */
  listGithubRepositories: entitledProcedure.query(async ({ ctx }) => {
    const service = new ConnectorDataService(
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId ?? undefined,
    );

    try {
      const client = await service.getGitHubClient();

      return { connected: true, repositories: await client.listAccessibleRepositories() };
    } catch (error) {
      if (isGithubUnavailable(error)) return { connected: false, repositories: [] };

      throw error;
    }
  }),

  removeFile: entitledProcedure
    .input(
      z.object({
        path: relativePathSchema,
        recursive: z.boolean().optional(),
        topicId: topicIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.client.deleteFile(input).catch(mapWorkspaceError)),

  /**
   * Edits the specification, which is what makes every instance of it out
   * of date. Nothing is rebuilt here: a rebuild discards whatever a
   * conversation installed by hand, so it stays the person's call, made per
   * copy from the list that now shows them as stale.
   */
  updateEnvironment: environmentProcedure
    .input(
      z.object({
        configuration: configurationSchema.optional(),
        description: z.string().max(2000).optional(),
        id: idSchema,
        name: nameSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      const updated = await ctx.environmentModel
        .update(id, changes)
        .catch(rethrowDuplicateEnvironmentName);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      return updated;
    }),

  /**
   * Only the label. The directory does not move: the built state sits in it,
   * and the execution plane has no rename that carries one to the other.
   */
  /**
   * Publishing an environment to the workspace, or taking it back.
   *
   * Its own mutation rather than a field on `updateEnvironment`, because the
   * two are not the same kind of edit: renaming is between you and your own
   * row, while this one decides who else can run in what this environment
   * built — and the client asks for confirmation before sending it.
   */
  setEnvironmentVisibility: environmentProcedure
    .input(z.object({ id: idSchema, visibility: visibilitySchema }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.environmentModel.setVisibility(input.id, input.visibility);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      return updated;
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

export type SandboxWorkspaceRouter = typeof sandboxWorkspaceRouter;
