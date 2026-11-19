import {
  artboardFileChangesSchema,
  artboardFileUploadsSchema,
  artboardOpSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  ArtboardService,
  ArtboardServiceError,
  type ArtboardServiceErrorCode,
} from '@/server/services/artboard';
import { ArtboardPublishService } from '@/server/services/artboard/publish';

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
      artboardPublishService: new ArtboardPublishService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
      artboardService: new ArtboardService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
      asAgent: (agentId: string) =>
        new ArtboardService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined, {
          context: { agentId },
        }),
    },
  });
});

const artboardProcedureWrite = artboardProcedure.use(withScopedPermission('agent:update'));

const artboardPublishProcedure = artboardProcedureWrite.use(
  requireWorkspaceRoleWhenScoped('member'),
);

const idInput = z.object({ id: z.string().min(1) });
const revisionInput = idInput.extend({ revision: z.number().int().positive() });

const commentInput = z.object({ commentId: z.string().min(1) });
const agentInput = z.object({ agentId: z.string().min(1) });
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

  deliverComments: artboardProcedureWrite
    .input(idInput)
    .mutation(({ ctx, input }) =>
      run('deliverComments', () => ctx.artboardService.takeUndeliveredComments(input.id)),
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
        files: artboardFileChangesSchema.optional(),
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

  getPublish: artboardProcedure
    .input(idInput)
    .query(({ ctx, input }) =>
      run('getPublish', () => ctx.artboardPublishService.getPublish(input.id)),
    ),

  getRevision: artboardProcedure
    .input(idInput)
    .query(({ ctx, input }) => run('getRevision', () => ctx.artboardService.getRevision(input.id))),

  list: artboardProcedure
    .input(z.object({ taskId: z.string().nullish(), topicId: z.string().nullish() }))
    .query(({ ctx, input }) => run('list', () => ctx.artboardService.list(input))),

  listFiles: artboardProcedure
    .input(idInput)
    .query(({ ctx, input }) => run('listFiles', () => ctx.artboardService.listFiles(input.id))),

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

  prepareFileUploads: artboardProcedureWrite
    .input(idInput.extend({ files: artboardFileUploadsSchema }))
    .mutation(({ ctx, input }) =>
      run('prepareFileUploads', () =>
        ctx.artboardService.prepareFileUploads(input.id, input.files),
      ),
    ),

  publish: artboardPublishProcedure
    .input(idInput)
    .mutation(({ ctx, input }) =>
      run('publish', () => ctx.artboardPublishService.publish(input.id)),
    ),

  read: artboardProcedure
    .input(idInput)
    .query(({ ctx, input }) => run('read', () => ctx.artboardService.read(input.id))),

  readFile: artboardProcedure
    .input(idInput.extend({ path: z.string().min(1) }))
    .query(({ ctx, input }) =>
      run('readFile', async () => {
        const { bytes, ...file } = await ctx.artboardService.readFile(input.id, input.path);
        return file.content === undefined
          ? { ...file, base64: Buffer.from(bytes).toString('base64') }
          : file;
      }),
    ),

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

  askQuestion: artboardProcedureWrite
    .input(
      idInput.merge(agentInput).extend({
        boardId: z.string().nullish(),
        content: commentContent,
        groupId: z.string().nullish(),
        pageId: z.string().nullish(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { agentId, id, ...question } = input;
      return run('askQuestion', () => ctx.asAgent(agentId).askQuestion(id, question));
    }),

  replyAsAgent: artboardProcedureWrite
    .input(commentInput.merge(agentInput).extend({ content: commentContent }))
    .mutation(({ ctx, input }) =>
      run('replyAsAgent', () =>
        ctx.asAgent(input.agentId).replyComment(input.commentId, { content: input.content }),
      ),
    ),

  takeComments: artboardProcedureWrite
    .input(idInput.merge(agentInput))
    .mutation(({ ctx, input }) =>
      run('takeComments', () => ctx.asAgent(input.agentId).takeUndeliveredComments(input.id)),
    ),

  submitRound: artboardProcedureWrite
    .input(idInput.extend({ roundId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      run('submitRound', () => ctx.artboardService.submitRound(input.id, input.roundId)),
    ),

  submitRounds: artboardProcedureWrite
    .input(idInput.extend({ roundIds: z.array(z.string().min(1)).max(200).optional() }))
    .mutation(({ ctx, input }) =>
      run('submitRounds', () => ctx.artboardService.submitOpenRounds(input.id, input.roundIds)),
    ),

  unpublish: artboardPublishProcedure
    .input(idInput)
    .mutation(({ ctx, input }) =>
      run('unpublish', () => ctx.artboardPublishService.unpublish(input.id)),
    ),

  update: artboardProcedureWrite
    .input(
      revisionInput.extend({
        files: artboardFileChangesSchema.optional(),
        ops: z.array(artboardOpSchema).max(200).default([]),
      }),
    )
    .mutation(({ ctx, input }) =>
      run('update', () =>
        ctx.artboardService.update(input.id, input.revision, input.ops, input.files),
      ),
    ),

  writeFiles: artboardProcedureWrite
    .input(idInput.extend({ files: artboardFileChangesSchema }))
    .mutation(({ ctx, input }) =>
      run('writeFiles', () => ctx.artboardService.writeFiles(input.id, input.files)),
    ),
});
