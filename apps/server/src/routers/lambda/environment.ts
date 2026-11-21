import { MAX_REPOSITORY_BRANCHES } from '@lobechat/connector-data/github';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { EnvironmentModel } from '@/database/models/environment';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  listScopeGitHubRepositories,
  listScopeGitHubRepositoryBranches,
  ScmRepositoriesUnavailableError,
} from '@/server/services/scm/repositories';

import { configurationSchema, newConfigurationSchema } from './_schema/environment';
import {
  rethrowDuplicateEnvironmentName,
  rethrowEnvironmentInUse,
} from './sandboxStorage/constraintErrors';
import { idSchema, nameSchema, visibilitySchema } from './sandboxStorage/schemas';

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

/**
 * GitHub reads go through the scope's GitHub App installations — the same
 * grant `resolveScmCloneCredential` clones with — so the picker offers exactly
 * what a build from the pick can check out. Not the person's own OAuth
 * connection: that sees more than any build can clone, and depends on a proxy
 * the clone never uses.
 */
const githubProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: { scope: { userId: ctx.userId, workspaceId: ctx.workspaceId ?? null } },
  });
});

/** The environment procedures, also answered under `sandboxStorage` for older clients. */
export const environmentProcedures = {
  /** A definition alone. Folders are initialized from it in the directory picker. */
  createEnvironment: environmentProcedure
    .input(
      z.object({
        configuration: newConfigurationSchema.optional(),
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
   * picked from what exists rather than typed. No installation granting the
   * repository is not an error, it is `connected: false`.
   */
  listGithubBranches: githubProcedure
    .input(z.object({ owner: z.string().min(1).max(255), repository: z.string().min(1).max(255) }))
    .query(async ({ ctx, input }) => {
      const branches = await listScopeGitHubRepositoryBranches(ctx.serverDB, ctx.scope, {
        limit: MAX_REPOSITORY_BRANCHES,
        repoFullName: `${input.owner}/${input.repository}`,
      });
      if (!branches) return { branches: [], connected: false, truncated: false };

      return {
        branches,
        connected: true,
        // At the ceiling the list may be missing branches, and a picker
        // that only offers what it was given would make those unselectable.
        truncated: branches.length >= MAX_REPOSITORY_BRANCHES,
      };
    }),

  /**
   * Every repository this scope's GitHub App installations can read, newest
   * push first, each carrying the owner it belongs to so the caller can group
   * them without a second request per organization.
   *
   * No installation is NOT an error here: it is the state the picker exists
   * to resolve, so it answers `connected: false` and lets the UI offer the
   * GitHub integration instead of a failure. `configured: false` says that
   * offer would lead nowhere: this server has no GitHub App to install.
   * `truncated` says an installation held more than the listing reads, so a
   * repository may be missing from the choices.
   */
  listGithubRepositories: githubProcedure.query(async ({ ctx }) => {
    let listed: Awaited<ReturnType<typeof listScopeGitHubRepositories>>;
    try {
      listed = await listScopeGitHubRepositories(ctx.serverDB, ctx.scope);
    } catch (error) {
      if (!(error instanceof ScmRepositoriesUnavailableError)) throw error;

      throw new TRPCError({ cause: error.cause, code: 'BAD_GATEWAY', message: error.message });
    }
    if (!listed.configured || listed.installations === 0) {
      return {
        configured: listed.configured,
        connected: false,
        repositories: [],
        truncated: false,
      };
    }

    return {
      configured: true,
      connected: true,
      truncated: listed.truncated,
      repositories: listed.repositories.map((item) => {
        const [owner, name] = item.fullName.split('/');
        return {
          defaultBranch: item.defaultBranch,
          isPrivate: item.private,
          name,
          owner,
        };
      }),
    };
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
};

export const environmentRouter = router(environmentProcedures);

export type EnvironmentRouter = typeof environmentRouter;
