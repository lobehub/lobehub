import { acceptanceVisibilities } from '@lobechat/const/verify';
import { TRPCError } from '@trpc/server';
import { inArray } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import { ProjectModel } from '@/database/models/project';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { AcceptanceItem } from '@/database/schemas/verify';
import { acceptances } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { isUuid } from '@/database/utils/uuid';
import { router } from '@/libs/trpc/lambda';
import { FileService } from '@/server/services/file';
import {
  mapWithConcurrency,
  previewAcceptancePurge,
  purgeAcceptance,
} from '@/server/services/verify';
import { acceptanceResponse } from '@/server/services/verify/acceptanceResponse';

import { canReadAcceptance } from '../_helpers/acceptanceReadScope';
import {
  acceptanceStatusOverrideSchema,
  applyAcceptanceStatus,
} from '../_helpers/acceptanceStatus';
import { filterManageableAcceptances } from '../_helpers/acceptanceWriteScope';
import * as goalGate from '../_helpers/goalGateAcceptance';
import {
  acceptanceProcedure,
  acceptanceWriteProcedure,
  resolveAcceptanceForWrite,
} from './procedures';

/**
 * The list panel's narrowing, shared by the flat and paged reads. `projectId:
 * null` asks for acceptances filed under no project.
 */
const acceptanceListFiltersSchema = z.object({
  filter: z.enum(['active', 'all', 'completed']).optional(),
  projectId: z.string().nullable().optional(),
  scope: z.enum(['all', 'created', 'participated']).optional(),
  source: z.enum(['all', 'goal', 'standalone', 'task', 'topic']).optional(),
});

/**
 * Tag each list row with whether the caller may rename, refile, re-status or
 * delete it. "Participated" rows are often someone else's, so the panel must
 * know which menus to offer instead of letting the write fail as NOT_FOUND.
 */
const withManageFlag = async <
  T extends Pick<AcceptanceItem, 'id' | 'userId' | 'visibility' | 'workspaceId'>,
>(
  ctx: { serverDB: LobeChatDatabase; userId: string },
  rows: T[],
): Promise<Array<T & { canManage: boolean }>> => {
  const manageable = new Set((await filterManageableAcceptances(ctx, rows)).map((row) => row.id));
  return rows.map((row) => ({ ...row, canManage: manageable.has(row.id) }));
};

/** Max rows one multi-select sweep may touch — the list itself is capped at 200. */
const ACCEPTANCE_BATCH_LIMIT = 200;

const PURGE_BATCH_CONCURRENCY = 4;

const PURGE_PREVIEW_LIMIT = 20;

export const listManagementRouter = router({
  /**
   * Recent acceptances (with subject headers), newest first — list panel + CLI.
   *
   * `limit` is capped rather than open: the read resolves each row's subject
   * title one by one, so an unbounded window would fan out. The merge picker
   * asks for the wide end because a target it cannot list is a target the user
   * cannot merge into.
   */
  list: acceptanceProcedure
    .input(
      acceptanceListFiltersSchema
        .extend({
          limit: z.number().int().min(1).max(200).optional(),
          q: z.string().max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) =>
      withManageFlag(ctx, await ctx.acceptanceService.listWithSubjects(input)),
    ),
  /**
   * One keyset page of the same feed — what the list panel scrolls.
   *
   * Speaks the same filter vocabulary as `list`, applied in the query, so a
   * page of "in progress" is a full page of in-progress rows. There is no
   * paged search on purpose: a title search must span the whole owned set,
   * which `list` already does — the panel asks that one while a query is live.
   */
  listPage: acceptanceProcedure
    .input(
      acceptanceListFiltersSchema
        .extend({
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const page = await ctx.acceptanceService.listPageWithSubjects({ ...input });
      return { ...page, items: await withManageFlag(ctx, page.items) };
    }),
  /**
   * Fold one acceptance into another: the source's verification rounds (and
   * with them its checks, verdicts and evidence) re-chain onto the target, and
   * the source entry is deleted.
   *
   * Both sides are creator-scoped like every other verify write — a merge
   * rewrites BOTH aggregates, so a workspace member must not be able to fold
   * another member's acceptance into (or out of) their own.
   */
  merge: acceptanceWriteProcedure
    .input(z.object({ sourceId: z.string(), targetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // A merge rewrites BOTH aggregates, so both have to authorize; the source
      // owns the rows that move, so its scope is the one the write runs in.
      const { acceptance: source, service } = await resolveAcceptanceForWrite(ctx, input.sourceId);
      const { acceptance: target } = await resolveAcceptanceForWrite(ctx, input.targetId);
      await goalGate.assertNotHoldingRelease(ctx.serverDB, source);
      await goalGate.assertNotHoldingRelease(ctx.serverDB, target);

      try {
        return await service.merge(source.id, target.id);
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to merge acceptance',
        });
      }
    }),
  /**
   * Flip who can read the acceptance beyond its creator. Creation defaults are
   * scope-dependent (personal → public, workspace → private, i.e. the whole
   * team); this is the deliberate override. Only the creator may make it
   * `owner`: a teammate must not hide someone else's delivery from its team.
   */
  setVisibility: acceptanceWriteProcedure
    .input(z.object({ id: z.string(), visibility: z.enum(acceptanceVisibilities) }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);
      if (input.visibility === 'owner' && acceptance.userId !== ctx.userId)
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can make an acceptance private',
        });

      const updated = await service.acceptanceModel.update(acceptance.id, {
        visibility: input.visibility,
      });
      // Cascade to every chained round: each round's report page is its own
      // shareable URL, so it must follow the umbrella (clobbering per-round
      // overrides on purpose — the aggregate flip is the deliberate act).
      await new VerifyRunModel(
        ctx.serverDB,
        acceptance.userId,
        acceptance.workspaceId ?? undefined,
      ).setVisibilityByAcceptance(acceptance.id, input.visibility);
      return updated ? acceptanceResponse(updated) : updated;
    }),
  /**
   * Rename the acceptance in the caller's list — a display-title override kept
   * on the aggregate's metadata. The subject's own title (the source topic /
   * task / document) is left untouched, so renaming the sidebar entry never
   * mutates the origin conversation.
   */
  rename: acceptanceWriteProcedure
    .input(z.object({ id: z.string(), title: z.string().trim().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      const updated = await service.acceptanceModel.patchMetadata(acceptance.id, {
        title: input.title,
      });
      return updated ? acceptanceResponse(updated) : updated;
    }),
  setProject: acceptanceWriteProcedure
    .input(z.object({ id: z.string(), projectId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      if (input.projectId) {
        const project = await new ProjectModel(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        ).findById(input.projectId);
        if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      await service.acceptanceModel.update(acceptance.id, {
        projectId: input.projectId,
      });
      return { success: true };
    }),
  /**
   * The multi-select twin of `setProject`: file a whole selection under one
   * project (or take it out of any) in one action.
   *
   * The target project is validated ONCE, up front — a missing project fails
   * the sweep wholesale, because every row was headed to the same place. Rows
   * keep the batch contract — one the caller cannot write lands in `failedIds`
   * instead of voiding the rest — but unlike the status sweep there is no
   * per-row recomputation, so the whole move is three bounded queries (resolve,
   * authorize, bulk update) rather than a round trip per row.
   */
  setProjectBatch: acceptanceWriteProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1).max(ACCEPTANCE_BATCH_LIMIT),
        projectId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.projectId) {
        const project = await new ProjectModel(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        ).findById(input.projectId);
        if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const ids = [...new Set(input.ids)];
      const resolvableIds = ids.filter((id) => isUuid(id));
      const rows =
        resolvableIds.length > 0
          ? await ctx.serverDB.query.acceptances.findMany({
              columns: { id: true, userId: true, visibility: true, workspaceId: true },
              where: inArray(acceptances.id, resolvableIds),
            })
          : [];
      const manageable = await filterManageableAcceptances(ctx, rows);

      let updatedIds: string[] = [];
      if (manageable.length > 0) {
        updatedIds = (
          await ctx.serverDB
            .update(acceptances)
            .set({ projectId: input.projectId })
            .where(
              inArray(
                acceptances.id,
                manageable.map((row) => row.id),
              ),
            )
            .returning({ id: acceptances.id })
        ).map((row) => row.id);
      }

      const updatedSet = new Set(updatedIds);
      return { failedIds: ids.filter((id) => !updatedSet.has(id)), updated: updatedIds.length };
    }),
  /**
   * Manually move the acceptance's user-facing lifecycle state from the list —
   * an owner override (mark accepted / closed / rejected, or reopen for another look).
   */
  updateStatus: acceptanceWriteProcedure
    .input(z.object({ id: z.string(), status: acceptanceStatusOverrideSchema }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);

      try {
        await applyAcceptanceStatus(ctx.serverDB, service, acceptance, input.status);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to update status',
        });
      }
      return { success: true };
    }),
  /**
   * The multi-select twin of `updateStatus`: sweep a backlog of deliveries into
   * accepted / closed in one action.
   *
   * A row that cannot take the transition (mid-verification, so undecidable;
   * or someone else's row in a workspace) is COLLECTED, not thrown: one
   * ineligible row must not void the other forty the user just swept, and the
   * caller reports what actually landed. Sequential on purpose — each accept
   * recomputes the aggregate and stamps its round, and a sweep is a background
   * chore, not a latency-critical path.
   */
  updateStatusBatch: acceptanceWriteProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1).max(ACCEPTANCE_BATCH_LIMIT),
        status: acceptanceStatusOverrideSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const failedIds: string[] = [];
      let updated = 0;

      for (const id of new Set(input.ids)) {
        try {
          const { acceptance, service } = await resolveAcceptanceForWrite(ctx, id);
          await applyAcceptanceStatus(ctx.serverDB, service, acceptance, input.status);
          updated += 1;
        } catch (error) {
          console.error('[acceptance] batch status update failed for %s', id, error);
          failedIds.push(id);
        }
      }

      return { failedIds, updated };
    }),
  purgePreview: acceptanceProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(PURGE_PREVIEW_LIMIT) }))
    .query(async ({ ctx, input }) => {
      const ids = [...new Set(input.ids)];
      const rows = ids.every(isUuid)
        ? await ctx.serverDB.query.acceptances.findMany({ where: inArray(acceptances.id, ids) })
        : [];
      const readable = await pMap(rows, (row) => canReadAcceptance(ctx, row), {
        concurrency: PURGE_BATCH_CONCURRENCY,
      });
      if (rows.length !== ids.length || readable.includes(false)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
      }

      const scopes = new Map<string, { ids: string[]; userId: string; workspaceId?: string }>();
      for (const row of rows) {
        const workspaceId = row.workspaceId ?? undefined;
        const key = workspaceId ?? `user:${row.userId}`;
        const scope = scopes.get(key) ?? { ids: [], userId: row.userId, workspaceId };
        scope.ids.push(row.id);
        scopes.set(key, scope);
      }
      const previews = await pMap(
        scopes.values(),
        (scope) => previewAcceptancePurge(ctx.serverDB, scope.userId, scope.workspaceId, scope.ids),
        { concurrency: PURGE_BATCH_CONCURRENCY },
      );
      return previews.reduce(
        (total, preview) => ({
          bytes: total.bytes + preview.bytes,
          fileCount: total.fileCount + preview.fileCount,
          files: {
            images: total.files.images + preview.files.images,
            other: total.files.other + preview.files.other,
            videos: total.files.videos + preview.files.videos,
          },
          rounds: total.rounds + preview.rounds,
        }),
        { bytes: 0, fileCount: 0, files: { images: 0, other: 0, videos: 0 }, rounds: 0 },
      );
    }),
  /**
   * Delete the acceptance aggregate. By default its chained verify runs detach
   * (acceptance_id → null via the FK's `set null`) so the individual round
   * reports stay reachable; `purge` also removes the rounds and the evidence
   * files only they referenced.
   */
  remove: acceptanceWriteProcedure
    .input(z.object({ id: z.string(), purge: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptance, service } = await resolveAcceptanceForWrite(ctx, input.id);
      await goalGate.assertNotHoldingRelease(ctx.serverDB, acceptance);

      if (input.purge) {
        await purgeAcceptance(
          ctx.serverDB,
          new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
          acceptance.userId,
          acceptance.workspaceId ?? undefined,
          acceptance.id,
        );
      } else {
        await service.acceptanceModel.delete(acceptance.id);
      }
      return { success: true };
    }),
  /**
   * The multi-select twin of `remove`. Like the batch status sweep, a row the
   * caller may not delete is collected rather than thrown, so the rest of the
   * selection still goes.
   */
  removeBatch: acceptanceWriteProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1).max(ACCEPTANCE_BATCH_LIMIT),
        purge: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const failedIds: string[] = [];
      let deleted = 0;
      const fileService = new FileService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);

      await mapWithConcurrency([...new Set(input.ids)], PURGE_BATCH_CONCURRENCY, async (id) => {
        try {
          const { acceptance, service } = await resolveAcceptanceForWrite(ctx, id);
          await goalGate.assertNotHoldingRelease(ctx.serverDB, acceptance);
          if (input.purge) {
            await purgeAcceptance(
              ctx.serverDB,
              fileService,
              acceptance.userId,
              acceptance.workspaceId ?? undefined,
              acceptance.id,
            );
          } else {
            await service.acceptanceModel.delete(acceptance.id);
          }
          deleted += 1;
        } catch (error) {
          console.error('[acceptance] batch delete failed for %s', id, error);
          failedIds.push(id);
        }
      });

      return { deleted, failedIds };
    }),
});
