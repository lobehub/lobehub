import type { AcceptanceFrameBoard, AcceptanceFrameBoardView } from '@lobechat/types';
import {
  acceptanceFrameBoardInputSchema,
  acceptanceFrameOperationSchema,
  artifactBoardManifestSchema,
  artifactBoardToFrameInput,
  resolveArtifactBoardChoices,
} from '@lobechat/types';
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

import { canReadAcceptance } from '../_helpers/acceptanceReadScope';
import { canManageAcceptance } from '../_helpers/acceptanceWriteScope';
import { assertCanvasRefs } from '../_helpers/canvasRefs';
import {
  acceptanceWriteProcedure,
  publicAcceptanceProcedure,
  resolveAcceptanceForWrite,
} from './procedures';

const FILE_RESOLVE_CONCURRENCY = 5;

/** Only real captures are files; versions are Canvas pages the viewer renders itself. */
const boardFileIds = (board: AcceptanceFrameBoard) => [
  ...new Set(board.frames.flatMap((frame) => frame.captures.map((capture) => capture.fileId))),
];

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
        input.board.frames.flatMap((frame) => frame.versions),
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

  /**
   * Turn an artifact board's choices into this board's candidates: one frame
   * whose versions are the picks of each round, the latest pick chosen as the
   * baseline candidate. Other frames, and any locked baseline, stay as they are.
   */
  publishBoardCandidates: acceptanceWriteProcedure
    .input(z.object({ boardId: z.string().min(1).max(64), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await resolveAcceptanceForWrite(ctx, input.id);
      const workModel = new WorkModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const found = await workModel.findBoard(input.boardId);
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Board not found' });

      const manifest = artifactBoardManifestSchema.parse(JSON.parse(found.version.content ?? ''));
      const choices = resolveArtifactBoardChoices(
        manifest,
        found.current.work.metadata?.board?.choices,
      );
      const frame = artifactBoardToFrameInput(input.boardId, manifest, choices);
      if (!frame)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Pick an option in at least one round before publishing',
        });

      await assertCanvasRefs(workModel, frame.versions);
      try {
        const board = await new AcceptanceFrameBoardModel(ctx.serverDB).mergeCandidates(
          input.id,
          frame,
          manifest.title,
        );
        return { board, frameKey: frame.key };
      } catch (error) {
        throw toTrpcError(error);
      }
    }),
});
