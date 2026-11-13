import { artboardOpSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  ArtboardService,
  ArtboardServiceError,
  type ArtboardServiceErrorCode,
} from '@/server/services/artboard';

const TRPC_CODES: Record<ArtboardServiceErrorCode, TRPCError['code']> = {
  conflict: 'CONFLICT',
  exists: 'CONFLICT',
  finalize_blocked: 'PRECONDITION_FAILED',
  invalid: 'BAD_REQUEST',
  locked: 'PRECONDITION_FAILED',
  no_project: 'BAD_REQUEST',
  not_found: 'NOT_FOUND',
  source_denied: 'FORBIDDEN',
};

const run = async <T>(label: string, action: () => Promise<T>): Promise<T> => {
  try {
    return await action();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof ArtboardServiceError)
      throw new TRPCError({ cause: error, code: TRPC_CODES[error.code], message: error.message });
    console.error(`[artboard:${label}]`, error);
    throw new TRPCError({
      cause: error,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Artboard failed',
    });
  }
};

const artboardProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      artboardService: new ArtboardService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
    },
  });
});

const artboardProcedureWrite = artboardProcedure.use(withScopedPermission('agent:update'));

const idInput = z.object({ id: z.string().min(1) });
const revisionInput = idInput.extend({ revision: z.number().int().positive() });

const commentInput = z.object({ commentId: z.string().min(1) });
const commentContent = z.string().trim().min(1).max(10_000);
const commentAnchor = z.union([
  z.object({ type: z.literal('canvas'), x: z.number().finite(), y: z.number().finite() }),
  z.object({
    nodePath: z.string().min(1),
    offsetX: z.number().min(0).max(1),
    offsetY: z.number().min(0).max(1),
    type: z.literal('node'),
  }),
]);

export const artboardRouter = router({
  addComment: artboardProcedureWrite
    .input(
      idInput.extend({
        anchor: commentAnchor.nullish(),
        boardId: z.string().nullish(),
        clientId: z.string().min(1),
        content: commentContent,
        groupId: z.string().nullish(),
        pageId: z.string().nullish(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...comment } = input;
      return run('addComment', () => ctx.artboardService.addComment(id, comment));
    }),

  chooseBoard: artboardProcedureWrite
    .input(idInput.extend({ boardId: z.string().min(1), roundId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      run('chooseBoard', () =>
        ctx.artboardService.chooseBoard(input.id, input.roundId, input.boardId),
      ),
    ),

  countUndeliveredComments: artboardProcedure
    .input(idInput)
    .query(({ ctx, input }) =>
      run('countUndeliveredComments', () => ctx.artboardService.countUndeliveredComments(input.id)),
    ),

  create: artboardProcedureWrite
    .input(
      z.object({
        description: z.string().nullish(),
        ops: z.array(artboardOpSchema).max(200).optional(),
        taskId: z.string().nullish(),
        title: z.string().trim().min(1),
        topicId: z.string().nullish(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { topicId, ...rest } = input;
      return run('create', () => ctx.artboardService.create(rest, { topicId }));
    }),

  finalize: artboardProcedureWrite
    .input(revisionInput)
    .mutation(({ ctx, input }) =>
      run('finalize', () => ctx.artboardService.finalize(input.id, input.revision)),
    ),

  get: artboardProcedure
    .input(idInput)
    .query(({ ctx, input }) => run('get', () => ctx.artboardService.get(input.id))),

  getByTask: artboardProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(({ ctx, input }) => run('getByTask', () => ctx.artboardService.getByTask(input.taskId))),

  getRevision: artboardProcedure
    .input(idInput)
    .query(({ ctx, input }) => run('getRevision', () => ctx.artboardService.getRevision(input.id))),

  list: artboardProcedure
    .input(z.object({ taskId: z.string().nullish(), topicId: z.string().nullish() }))
    .query(({ ctx, input }) => run('list', () => ctx.artboardService.list(input))),

  listComments: artboardProcedure
    .input(idInput)
    .query(({ ctx, input }) =>
      run('listComments', () => ctx.artboardService.listComments(input.id)),
    ),

  listByProject: artboardProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      run('listByProject', () => ctx.artboardService.listByProject(input.projectId)),
    ),

  read: artboardProcedure
    .input(idInput)
    .query(({ ctx, input }) => run('read', () => ctx.artboardService.read(input.id))),

  reopenComment: artboardProcedureWrite
    .input(commentInput)
    .mutation(({ ctx, input }) =>
      run('reopenComment', () => ctx.artboardService.reopenComment(input.commentId)),
    ),

  replyComment: artboardProcedureWrite
    .input(commentInput.extend({ clientId: z.string().min(1), content: commentContent }))
    .mutation(({ ctx, input }) =>
      run('replyComment', () =>
        ctx.artboardService.replyComment(input.commentId, {
          clientId: input.clientId,
          content: input.content,
        }),
      ),
    ),

  resolveComment: artboardProcedureWrite
    .input(commentInput)
    .mutation(({ ctx, input }) =>
      run('resolveComment', () => ctx.artboardService.resolveComment(input.commentId)),
    ),

  submitRound: artboardProcedureWrite
    .input(idInput.extend({ roundId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      run('submitRound', () => ctx.artboardService.submitRound(input.id, input.roundId)),
    ),

  update: artboardProcedureWrite
    .input(revisionInput.extend({ ops: z.array(artboardOpSchema).min(1).max(200) }))
    .mutation(({ ctx, input }) =>
      run('update', () => ctx.artboardService.update(input.id, input.revision, input.ops)),
    ),
});
