import { ConnectorDataError } from '@lobechat/connector-data';
import { MAX_REPOSITORY_BRANCHES } from '@lobechat/connector-data/github';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { EnvironmentModel } from '@/database/models/environment';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ConnectorDataService } from '@/server/services/connectorData';

import {
  rethrowDuplicateEnvironmentName,
  rethrowEnvironmentInUse,
} from './_helpers/environmentErrors';
import { configurationSchema, idSchema, nameSchema, visibilitySchema } from './_schema/environment';

/**
 * Code environments: the definitions a folder can be initialized from — the
 * repository to check out, what makes it usable, what it runs with.
 *
 * Definitions only, and answered from the database alone, so nothing here asks
 * for a drive: writing down how to set up a project is useful before anyone
 * has somewhere to run it, and is the same whether it is later run in the
 * cloud sandbox or on a device. What is built from a definition lives on the
 * drive and is managed through `sandboxStorage`, which does ask.
 */

/**
 * "You have not connected GitHub" travels as an error from the connector layer,
 * but for the picker it is an answer, not a failure — the one it is there to
 * help the user fix.
 */
const isGithubUnavailable = (error: unknown): boolean =>
  error instanceof ConnectorDataError && error.provider === 'github' && !error.retryable;

const environmentProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
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

const githubProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      connectorDataService: new ConnectorDataService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

export const environmentRouter = router({
  /** A definition alone. Folders are initialized from it in the directory picker. */
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

  /** Specifications only. Nothing here needs a sandbox session to answer. */
  listEnvironments: environmentProcedure
    .input(z.object({ visibility: visibilitySchema.optional() }).optional())
    .query(async ({ ctx, input }) => ({
      environments: await ctx.environmentModel.query(input?.visibility),
    })),

  /**
   * The branches of one repository, so the environment's checkout target is
   * picked from what exists rather than typed. No connection is not an error,
   * it is `connected: false`.
   */
  listGithubBranches: githubProcedure
    .input(z.object({ owner: z.string().min(1).max(255), repository: z.string().min(1).max(255) }))
    .query(async ({ ctx, input }) => {
      try {
        const client = await ctx.connectorDataService.getGitHubClient();
        const branches = await client.listRepositoryBranches(input.owner, input.repository);

        return {
          branches,
          connected: true,
          // At the ceiling the list may be missing branches, and a picker
          // that only offers what it was given would make those unselectable.
          truncated: branches.length >= MAX_REPOSITORY_BRANCHES,
        };
      } catch (error) {
        if (isGithubUnavailable(error)) return { branches: [], connected: false, truncated: false };

        throw error;
      }
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
  listGithubRepositories: githubProcedure.query(async ({ ctx }) => {
    try {
      const client = await ctx.connectorDataService.getGitHubClient();

      return { connected: true, repositories: await client.listAccessibleRepositories() };
    } catch (error) {
      if (isGithubUnavailable(error)) return { connected: false, repositories: [] };

      throw error;
    }
  }),

  /**
   * Refused while any folder is still initialized from it: the reference is
   * `restrict`, and those folders are removed from the environment's list
   * first — removing one drops what was built on the drive, which only the
   * drive's own router can do.
   */
  removeEnvironment: environmentProcedure
    .input(z.object({ id: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const environment = await ctx.environmentModel.findOwnedById(input.id);
      if (!environment)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      const removed = await ctx.environmentModel.delete(input.id).catch(rethrowEnvironmentInUse);
      if (!removed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });

      return removed;
    }),

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

  /**
   * Edits the specification. Existing instances keep the one they were created
   * with — a change here shapes what the NEXT folder is built from and touches
   * nothing a conversation has already installed or produced.
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
});

export type EnvironmentRouter = typeof environmentRouter;
