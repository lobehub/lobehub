import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { EnvironmentModel } from '@/database/models/environment';
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
 * The row's id, which doubles as the name the snapshot is stored under. Checked
 * for shape rather than left to the lookup, because the lookup cannot answer:
 * a non-UUID compared against a `uuid` column is a Postgres type error, so the
 * caller would get a server fault where "no such environment" was the answer.
 */
const environmentIdSchema = z.string().uuid();

/** The indexes that make a name identify one environment for one member. */
const ENVIRONMENT_NAME_CONSTRAINTS = new Set([
  'environments_user_name_unique',
  'environments_workspace_user_name_unique',
]);

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

export const sandboxWorkspaceRouter = router({
  /**
   * Whether this caller has a persistent workspace at all. The client pairs it
   * with the lab flag it already holds: flag off renders nothing, flag on
   * without an entitlement renders the upgrade prompt, and both renders the
   * workspace.
   */
  createDirectory: entitledProcedure
    .input(z.object({ path: relativePathSchema, topicId: topicIdSchema }))
    .mutation(async ({ ctx, input }) => ctx.client.createDirectory(input).catch(mapWorkspaceError)),

  getEntitlement: workspaceProcedure.query(async ({ ctx }) => ({
    entitled: Boolean(ctx.claim),
    quotaBytes: ctx.claim?.quotaBytes ?? null,
  })),

  copyEnvironment: environmentProcedure
    .input(
      z.object({
        description: z.string().max(2000).optional(),
        id: environmentIdSchema,
        name: nameSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.environmentModel.findById(input.id);
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      // Metadata first: a copy whose snapshot succeeded but whose row is
      // missing would be an environment nobody can name, and therefore nobody
      // can delete. The reverse — a row whose snapshot never arrived — is the
      // same state as a brand-new environment, which the UI already handles.
      const created = await ctx.environmentModel
        .create({
          // The specification comes along; the snapshot is copied separately
          // below. Leaving it behind would produce a copy that rebuilds into
          // something else entirely the first time its cache is dropped.
          configuration: source.configuration,
          description: input.description ?? source.description,
          name: input.name,
        })
        .catch(rethrowDuplicateEnvironmentName);

      await ctx.client.copyEnvironment({ from: source.id, to: created.id }).catch(async (error) => {
        await ctx.environmentModel.delete(created.id);
        return mapWorkspaceError(error);
      });

      return created;
    }),

  createEnvironment: environmentProcedure
    .input(z.object({ description: z.string().max(2000).optional(), name: nameSchema }))
    .mutation(async ({ ctx, input }) =>
      ctx.environmentModel.create(input).catch(rethrowDuplicateEnvironmentName),
    ),

  getWorkspace: entitledProcedure.query(async ({ ctx }) =>
    ctx.client.getWorkspace().catch(mapWorkspaceError),
  ),

  listEnvironments: environmentProcedure
    .input(z.object({ topicId: topicIdSchema }).optional())
    .query(async ({ ctx, input }) => {
      const [metadata, snapshots] = await Promise.all([
        ctx.environmentModel.query(),
        ctx.client
          .listEnvironments({ topicId: input?.topicId })
          .then((result) => result.environments)
          // The snapshot store is reachable only through a sandbox session. If
          // that fails, the environments still exist and can still be renamed
          // or selected — only their sizes are unknown, so say so rather than
          // failing a settings page.
          .catch(() => null),
      ]);

      const byId = new Map((snapshots ?? []).map((snapshot) => [snapshot.name, snapshot]));

      return {
        environments: metadata.map((environment) => ({
          createdAt: environment.createdAt,
          description: environment.description,
          id: environment.id,
          name: environment.name,
          snapshot: byId.get(environment.id) ?? null,
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

  removeEnvironment: environmentProcedure
    .input(z.object({ id: environmentIdSchema, topicId: topicIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const environment = await ctx.environmentModel.findById(input.id);
      if (!environment)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      // Snapshot first, and only drop the row once it is gone: a row removed
      // while the snapshot survives leaves storage nobody can see, name, or
      // reclaim. The execution plane refuses while a session is using it, and
      // that refusal is the one the user needs to see.
      await ctx.client
        .deleteEnvironment({ name: environment.id, topicId: input.topicId })
        .catch(mapWorkspaceError);

      return ctx.environmentModel.delete(input.id);
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

  renameEnvironment: environmentProcedure
    .input(
      z.object({
        description: z.string().max(2000).optional(),
        id: environmentIdSchema,
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
});

export type SandboxWorkspaceRouter = typeof sandboxWorkspaceRouter;
