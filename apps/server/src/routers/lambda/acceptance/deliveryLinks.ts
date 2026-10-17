import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { VerifyRunModel } from '@/database/models/verifyRun';
import { notifyAcceptance } from '@/server/services/acceptanceReview/events';
import { parseChangeRequestUrl } from '@/server/services/scm/changeRequestUrl';
import {
  addPullRequestLink,
  removePullRequestLink,
  updateAcceptancePullRequests,
} from '@/server/services/verify/acceptancePullRequests';

import { previewUrlSchema, recordPreviewUrl } from '../_helpers/acceptancePreviewUrl';
import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { acceptanceWriteProcedure, resolveAcceptanceForWrite } from './procedures';

export const deliveryLinksProcedures = {
  /**
   * Chain an existing verify run onto an acceptance as its next round.
   * Idempotent when the run is already chained to the same acceptance (the
   * ingest CLI re-runs against a remembered session).
   */
  attachRun: acceptanceWriteProcedure
    .input(z.object({ acceptanceId: z.string(), verifyRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.acceptanceId);

      // The attach rewrites the RUN's acceptance_id/round_index too — and a
      // workspace-visible run is not necessarily the caller's. Creator-scope it
      // like every other verify write, or a member could chain another
      // member's report onto their aggregate.
      const run = await new VerifyRunModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ).findById(input.verifyRunId);
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification run not found' });
      }
      assertWorkspaceRowManageable(ctx, run.userId, 'verify run');

      try {
        return await service.attachRun(run.id, acceptance.id);
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to attach run',
        });
      }
    }),
  /**
   * Record that a pull request delivers this acceptance. The link lives on the
   * acceptance, not on a round: the pull request usually opens after the
   * rounds that verified it, and stacked pull requests share one acceptance.
   *
   * Stored on the acceptance rather than on the shared `scm_change_requests`
   * row: that row is keyed globally and owned by whichever tenant the
   * provider routes the PR to, so a pasted URL must not claim it. A hand
   * link is display-only and never drives merge → accepted.
   */
  linkPullRequest: acceptanceWriteProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().trim().min(1).max(500).optional(),
        url: z.string().max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { acceptance } = await resolveAcceptanceForWrite(ctx, input.id);
      const parsed = parseChangeRequestUrl(input.url);
      if (!parsed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Expected a GitHub pull request URL, e.g. https://github.com/owner/repo/pull/123',
        });
      }

      await updateAcceptancePullRequests(ctx.serverDB, acceptance.id, (links) =>
        addPullRequestLink(links, parsed, input.title),
      );
      return parsed;
    }),
  unlinkPullRequest: acceptanceWriteProcedure
    .input(z.object({ id: z.string(), url: z.string().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance } = await resolveAcceptanceForWrite(ctx, input.id);
      const parsed = parseChangeRequestUrl(input.url);
      const pullRequests = parsed
        ? await updateAcceptancePullRequests(ctx.serverDB, acceptance.id, (links) =>
            removePullRequestLink(links, parsed),
          )
        : null;
      if (!pullRequests) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Linked pull request not found' });
      }

      return { success: true };
    }),
  /**
   * File the acceptance under a project (or take it out of one) from the list.
   * Only the grouping pointer moves: the delivery, its rounds and its subject
   * are untouched, so this is reversible and never rewrites history.
   *
   * The bar is READABLE, not manageable: a delivery may be filed under any
   * project the caller can see — the same set the list already groups by — so
   * a workspace member is not blocked from filing under a teammate's project.
   */
  setPreviewUrl: acceptanceWriteProcedure
    .input(z.object({ id: z.string(), url: previewUrlSchema }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance } = await resolveAcceptanceForWrite(ctx, input.id);
      const run = await recordPreviewUrl(ctx.serverDB, acceptance.id, input.url);
      if (run) notifyAcceptance(acceptance.id, 'session', ctx.userId);
      if (!run)
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'The acceptance has no round to attach a preview to yet',
        });
      return { previewUrl: input.url, roundIndex: run.roundIndex };
    }),
};
