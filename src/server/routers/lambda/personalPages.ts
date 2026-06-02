import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { PersonalPagesService } from '@/server/services/personalPages';

const liteXMLOperationSchema = z.union([
  z.object({
    action: z.literal('insert'),
    beforeId: z.string(),
    litexml: z.string(),
  }),
  z.object({
    action: z.literal('insert'),
    afterId: z.string(),
    litexml: z.string(),
  }),
  z.object({
    action: z.literal('modify'),
    litexml: z.union([z.string(), z.array(z.string())]),
  }),
  z.object({
    action: z.literal('remove'),
    id: z.string(),
  }),
]);

const personalPagesProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      personalPagesService: new PersonalPagesService(ctx.serverDB, ctx.userId),
    },
  });
});

export const personalPagesRouter = router({
  createPage: personalPagesProcedure
    .input(
      z.object({
        content: z.string().default(''),
        title: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.personalPagesService.createPage(input.title, input.content);
    }),

  readPage: personalPagesProcedure
    .input(
      z.object({
        format: z.enum(['markdown', 'xml', 'both']).optional(),
        id: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.personalPagesService.readPage(input.id, { format: input.format });
    }),

  replaceContent: personalPagesProcedure
    .input(
      z.object({
        content: z.string(),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.personalPagesService.replaceContent(input.id, input.content);
    }),

  modifyNodes: personalPagesProcedure
    .input(
      z.object({
        id: z.string(),
        operations: z.array(liteXMLOperationSchema).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.personalPagesService.modifyNodes(input.id, input.operations);
    }),

  listPages: personalPagesProcedure.query(async ({ ctx }) => {
    return ctx.personalPagesService.listPages();
  }),
});

export type PersonalPagesRouter = typeof personalPagesRouter;
