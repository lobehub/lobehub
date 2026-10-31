import type {
  AcceptanceFrameBoard,
  AcceptanceFrameBoardInput,
  AcceptanceFrameBoardView,
} from '@lobechat/types';
import { acceptanceFrameBoardInputSchema, acceptanceFrameOperationSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import {
  AcceptanceFrameBoardError,
  AcceptanceFrameBoardModel,
} from '@/database/models/acceptanceFrameBoard';
import { WorkModel } from '@/database/models/work';
import { acceptances } from '@/database/schemas/verify';
import { isUuid } from '@/database/utils/uuid';
import { router } from '@/libs/trpc/lambda';
import { createEvidenceFileResolver } from '@/server/services/verify';

import { canManageAcceptance } from '../_helpers/acceptanceWriteScope';
import {
  acceptanceWriteProcedure,
  canReadAcceptance,
  publicAcceptanceProcedure,
  resolveAcceptanceForWrite,
} from './procedures';

const FILE_RESOLVE_CONCURRENCY = 5;

/** Only real captures are files; versions are Canvas pages the viewer renders itself. */
const boardFileIds = (board: AcceptanceFrameBoard) => [
  ...new Set(board.frames.flatMap((frame) => frame.captures.map((capture) => capture.fileId))),
];

/**
 * Every version must name a Canvas version the publisher can open. A typo
 * would otherwise surface only as a blank reference in front of reviewers.
 */
const assertCanvasRefs = async (workModel: WorkModel, board: AcceptanceFrameBoardInput) => {
  const refs = new Map<string, { canvasId: string; canvasVersion: number }>();
  for (const frame of board.frames)
    for (const { canvasId, canvasVersion } of frame.versions)
      refs.set(`${canvasId}@${canvasVersion}`, { canvasId, canvasVersion });

  await pMap(
    refs.values(),
    async ({ canvasId, canvasVersion }) => {
      const current = await workModel.findCanvas(canvasId);
      const version =
        current && canvasVersion === current.version.version
          ? current.version
          : current && (await workModel.findCanvasVersion(current.work.id, canvasVersion));
      if (!version?.metadata?.canvas)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Canvas ${canvasId} has no version ${canvasVersion}`,
        });
    },
    { concurrency: FILE_RESOLVE_CONCURRENCY },
  );
};

const toTrpcError = (error: unknown) => {
  if (error instanceof AcceptanceFrameBoardError)
    return new TRPCError({ code: error.code, message: error.message });
  return error;
};

export const framesRouter = router({
  /**
   * The board with every image resolved to a display URL. Readable by whoever
   * can read the acceptance — the same gate as the bundle, NOT_FOUND on denial.
   */
  getFrameBoard: publicAcceptanceProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }): Promise<AcceptanceFrameBoardView | null> => {
      const acceptance = isUuid(input.id)
        ? await ctx.serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, input.id) })
        : undefined;
      if (!acceptance || !(await canReadAcceptance(ctx, acceptance)))
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });

      const board = acceptance.metadata?.frameBoard;
      if (!board) return null;

      const resolveFile = createEvidenceFileResolver(
        ctx.serverDB,
        acceptance.userId,
        acceptance.workspaceId ?? undefined,
      );
      const entries = await pMap(
        boardFileIds(board),
        async (fileId) => {
          const meta = await resolveFile(fileId);
          return [
            fileId,
            { fileHeight: meta.fileHeight, fileUrl: meta.fileUrl, fileWidth: meta.fileWidth },
          ] as const;
        },
        { concurrency: FILE_RESOLVE_CONCURRENCY },
      );

      return {
        ...board,
        canEdit: await canManageAcceptance(ctx, acceptance),
        images: Object.fromEntries(entries),
      };
    }),

  /** Author or revise the board. Review state survives for every frame key that stays. */
  publishFrameBoard: acceptanceWriteProcedure
    .input(
      z.object({
        board: acceptanceFrameBoardInputSchema,
        expectedVersion: z.number().int().nonnegative().optional(),
        id: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await resolveAcceptanceForWrite(ctx, input.id);
      await assertCanvasRefs(
        new WorkModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
        input.board,
      );
      try {
        return await new AcceptanceFrameBoardModel(ctx.serverDB).publish(
          input.id,
          input.board,
          input.expectedVersion,
        );
      } catch (error) {
        throw toTrpcError(error);
      }
    }),

  /** Choose a version, edit or lock its acceptance points, attach and judge real captures. */
  updateFrame: acceptanceWriteProcedure
    .input(
      z.object({
        expectedVersion: z.number().int().nonnegative().optional(),
        frameId: z.string().min(1).max(64),
        id: z.string().uuid(),
        operation: acceptanceFrameOperationSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await resolveAcceptanceForWrite(ctx, input.id);
      try {
        return await new AcceptanceFrameBoardModel(ctx.serverDB).apply(
          input.id,
          input.frameId,
          input.operation,
          ctx.userId,
          input.expectedVersion,
        );
      } catch (error) {
        throw toTrpcError(error);
      }
    }),
});
