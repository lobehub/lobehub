import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { EnvironmentModel } from '@/database/models/environment';
import { EnvironmentInstanceModel } from '@/database/models/environmentInstance';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
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

/** The indexes that make a name identify one environment for one member. */
const ENVIRONMENT_NAME_CONSTRAINTS = new Set([
  'environments_user_name_unique',
  'environments_workspace_user_name_unique',
]);

/** The index that keeps two working copies out of the same directory. */
const INSTANCE_DIRECTORY_CONSTRAINT = 'environment_instances_provider_path_unique';

/**
 * The environment a working copy belongs to when nobody has written a
 * specification yet. Renameable — it is an ordinary row, not a sentinel.
 */
const DEFAULT_ENVIRONMENT_NAME = 'Default';

/**
 * Where source material comes from. Only `git` for now, and only over HTTPS:
 * the other transports authenticate with a key, and a specification that
 * carries no credentials cannot present one. Private repositories are a
 * separate problem, not a URL scheme.
 */
const environmentSourceSchema = z.object({
  kind: z.literal('git'),
  /** Where the checkout lands, relative to the working copy's own directory. */
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
  internetAccess: z.boolean().optional(),
  sources: z.array(environmentSourceSchema).max(8).optional(),
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
 * Two working copies in one directory would restore two package sets over each
 * other's files, so the database refuses it and the person picks another
 * directory. Same reasoning as a duplicate name, different fix.
 */
const rethrowDuplicateInstanceDirectory = (error: unknown): never => {
  if (
    getPostgresErrorField(error, 'code') === '23505' &&
    getPostgresErrorField(error, 'constraint') === INSTANCE_DIRECTORY_CONSTRAINT
  ) {
    throw new TRPCError({
      cause: error,
      code: 'CONFLICT',
      message: 'DUPLICATE_INSTANCE_DIRECTORY',
    });
  }

  throw error;
};

/**
 * An environment with working copies still on it. The reference is `restrict`
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
 * Where a working copy lives, in the vocabulary `environment_instances` uses
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
   * Fork a working copy: a second directory that starts with everything the
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
      const source = await ctx.instanceModel.findById(input.id);
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
   * The working copy at this directory, created if there is not one yet.
   *
   * What the composer calls when someone picks a directory: a person choosing
   * where their files should live is not choosing a specification, so one is
   * supplied rather than demanded. Until the settings page exists that means a
   * single environment per member, which is also the truthful state of things —
   * nothing can be built from a specification until the execution plane can run
   * one, so every copy today is simply a directory plus whatever the
   * conversation installed into it.
   *
   * Idempotent on the directory, because the composer writes the choice on
   * every click and the second click must not fail on the unique index.
   */
  useInstanceAtDirectory: instanceProcedure
    .input(z.object({ workingDirectory: relativePathSchema }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.instanceModel.findByWorkingDirectory(input.workingDirectory);
      if (existing) return existing;

      const environment = await ctx.environmentModel.ensureNamed(DEFAULT_ENVIRONMENT_NAME);
      const created = await ctx.instanceModel
        .create({
          ...sandboxBinding(ctx.claim.key),
          environmentId: environment.id,
          // The directory is the only thing the person chose, so it is also the
          // only honest label until they rename it.
          name: input.workingDirectory,
          workingDirectory: input.workingDirectory,
        })
        .catch(rethrowDuplicateInstanceDirectory);

      if (!created) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      return created;
    }),

  /**
   * A working copy of an environment: its own directory, its own captured
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
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.environmentModel.create(input).catch(rethrowDuplicateEnvironmentName),
    ),

  /**
   * One working copy, from the database alone. Separate from `listInstances`
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
  listEnvironments: environmentProcedure.query(async ({ ctx }) => ({
    environments: await ctx.environmentModel.query(),
  })),

  /**
   * Working copies, each joined with the state the execution plane actually
   * holds for it. An instance that was created but never used has no snapshot
   * yet, which is a normal state and not an error.
   */
  listInstances: instanceProcedure
    .input(z.object({ environmentId: idSchema.optional(), topicId: topicIdSchema }))
    .query(async ({ ctx, input }) => {
      const [instances, snapshots] = await Promise.all([
        ctx.instanceModel.query({ environmentId: input.environmentId }),
        ctx.client
          .listEnvironments({ topicId: input.topicId })
          .then((result) => result.environments)
          // The snapshot store is reachable only through a sandbox session. If
          // that fails, the instances still exist and can still be renamed or
          // selected — only their sizes are unknown, so say so rather than
          // failing a settings page.
          .catch(() => null),
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

  /** Refused while working copies still reference it — those go first. */
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
      const instance = await ctx.instanceModel.findById(input.id);
      if (!instance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instance not found' });

      // Snapshot first, and only drop the row once it is gone: a row removed
      // while the snapshot survives leaves storage nobody can see, name, or
      // reclaim. The execution plane refuses while a session is using it, and
      // that refusal is the one the user needs to see.
      await ctx.client
        .deleteEnvironment({ name: instance.id, topicId: input.topicId })
        .catch(mapWorkspaceError);

      return ctx.instanceModel.delete(input.id);
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
   * Edits the specification, which is what makes every working copy of it out
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
