import { ConnectorDataError } from '@lobechat/connector-data';
import { MAX_REPOSITORY_BRANCHES } from '@lobechat/connector-data/github';
import { z } from 'zod';

import { ConnectorDataService } from '@/server/services/connectorData';

import { entitledProcedure } from './procedures';

/**
 * "You have not connected GitHub" travels as an error from the connector layer,
 * but for the picker it is an answer, not a failure — the one it is there to
 * help the user fix.
 */
const isGithubUnavailable = (error: unknown): boolean =>
  error instanceof ConnectorDataError && error.provider === 'github' && !error.retryable;

export const githubProcedures = {
  /**
   * Every repository this account can build an environment from, newest
   * activity first, each carrying the owner it belongs to so the caller can
   * group them without a second request per organization.
   *
   * A missing GitHub connection is NOT an error here: it is the state the
   * picker exists to resolve, so it answers `connected: false` and lets the
   * UI offer the connection instead of a failure.
   */
  /**
   * The branches of one repository, so the environment's checkout target is
   * picked from what exists rather than typed. Same shape as the repository
   * listing: no connection is not an error, it is `connected: false`.
   */
  listGithubBranches: entitledProcedure
    .input(z.object({ owner: z.string().min(1).max(255), repository: z.string().min(1).max(255) }))
    .query(async ({ ctx, input }) => {
      const service = new ConnectorDataService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );

      try {
        const client = await service.getGitHubClient();
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
};
