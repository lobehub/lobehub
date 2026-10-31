import type { ArtifactBoardView } from '@lobechat/types';
import {
  artifactBoardManifestSchema,
  artifactBoardToFrameInput,
  resolveArtifactBoardChoices,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { createArtifactBoardId, WorkModel } from '@/database/models/work';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { assertCanvasRefs } from './_helpers/canvasRefs';

const boardProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { workModel: new WorkModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined) },
  });
});

const boardIdSchema = z
  .string()
  .trim()
  .regex(/^board_\w{1,40}$/);

const readBoard = async (
  workModel: WorkModel,
  boardId: string,
  version?: number,
): Promise<ArtifactBoardView | null> => {
  const found = await workModel.findBoard(boardId, version);
  if (!found) return null;
  // Every stored manifest passed this schema on publish; a parse failure means
  // the row was edited outside this router, which must not render half a board.
  const manifest = artifactBoardManifestSchema.parse(JSON.parse(found.version.content ?? ''));
  return {
    boardId,
    choices: resolveArtifactBoardChoices(manifest, found.current.work.metadata?.board?.choices),
    createdAt: found.version.createdAt,
    latestVersion: found.current.version.version,
    manifest,
    title: manifest.title,
    version: found.version.version,
    workId: found.current.work.id,
  };
};

/**
 * Artifact boards: rounds of Canvas options and the choice made in each. The
 * manifest is a Work version; choices live on the Work, so picking never mints
 * a version and republishing never forgets a pick that still applies.
 */
export const artifactBoardRouter = router({
  choose: boardProcedure
    .use(requireWorkspaceRoleWhenScoped('member'))
    .input(
      z.object({
        boardId: boardIdSchema,
        optionId: z.string().min(1).max(64),
        roundId: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.workModel.chooseBoardOption({
        boardId: input.boardId,
        chosenBy: ctx.userId,
        optionId: input.optionId,
        roundId: input.roundId,
      });
      if (result.status === 'boardNotFound')
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Board not found' });
      if (result.status === 'optionNotFound')
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Option not found in this round' });

      const board = await readBoard(ctx.workModel, input.boardId);
      if (!board) throw new TRPCError({ code: 'NOT_FOUND', message: 'Board not found' });
      return board;
    }),

  get: boardProcedure
    .input(z.object({ boardId: boardIdSchema, version: z.number().int().positive().optional() }))
    .query(({ ctx, input }) => readBoard(ctx.workModel, input.boardId, input.version)),

  /** Create a board, or publish the next manifest version of an existing one. */
  publish: boardProcedure
    .use(requireWorkspaceRoleWhenScoped('member'))
    .input(
      z.object({
        boardId: boardIdSchema.optional(),
        context: z
          .object({
            agentId: z.string().nullish(),
            threadId: z.string().nullish(),
            topicId: z.string().nullish(),
          })
          .optional(),
        manifest: artifactBoardManifestSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.boardId && !(await ctx.workModel.findBoard(input.boardId)))
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Board not found' });
      await assertCanvasRefs(
        ctx.workModel,
        input.manifest.rounds.flatMap((round) => round.options),
      );

      const boardId = input.boardId ?? createArtifactBoardId();
      await ctx.workModel.registerBoard({
        agentId: input.context?.agentId,
        boardId,
        manifest: input.manifest,
        threadId: input.context?.threadId,
        topicId: input.context?.topicId,
      });
      return (await readBoard(ctx.workModel, boardId))!;
    }),

  /** The choices as the frame definition `lh acceptance frames publish` reads. */
  toFrames: boardProcedure
    .input(z.object({ boardId: boardIdSchema }))
    .query(async ({ ctx, input }) => {
      const board = await readBoard(ctx.workModel, input.boardId);
      if (!board) throw new TRPCError({ code: 'NOT_FOUND', message: 'Board not found' });
      const frame = artifactBoardToFrameInput(input.boardId, board.manifest, board.choices);
      return { frames: frame ? [frame] : [], title: board.title, transitions: [] };
    }),
});
