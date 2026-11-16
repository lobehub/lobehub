import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { TfsConnectionService } from '@/server/services/tfs/connection';
import { TfsRequestError } from '@/server/services/tfs/transport';

const hasControlCharacter = (value: string) => [...value].some((char) => char.codePointAt(0)! < 32);

const segment = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (s) =>
      !s.includes('\\') && !s.includes('/') && !hasControlCharacter(s) && !['.', '..'].includes(s),
  );
const projectInput = z.object({ project: segment });
const id = z.number().int().positive();
const cursor = z.string().max(1024).optional();
const tfsProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  const result = await next({ ctx: { tfs: new TfsConnectionService(ctx.serverDB, ctx.userId) } });
  if (result.ok || result.error.code !== 'INTERNAL_SERVER_ERROR') return result;
  const error = result.error.cause;
  if (error instanceof TfsRequestError) {
    throw new TRPCError({
      code:
        error.status === 401
          ? 'BAD_REQUEST'
          : error.status === 403
            ? 'FORBIDDEN'
            : error.status === 404
              ? 'NOT_FOUND'
              : 'BAD_GATEWAY',
      message: error.message,
    });
  }
  throw new TRPCError({ code: 'BAD_GATEWAY', message: 'TFS_REQUEST_FAILED' });
});

export const tfsRouter = router({
  branches: tfsProcedure
    .input(projectInput.extend({ cursor, repository: segment }))
    .query(async ({ ctx, input }) =>
      (await ctx.tfs.client()).branches(input.project, input.repository, input.cursor),
    ),
  browse: tfsProcedure
    .input(
      projectInput.extend({
        cursor,
        kind: z.enum(['prs', 'builds', 'releases', 'tfvc']),
        path: z.string().max(2000).optional(),
        repository: segment.optional(),
        version: id.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.kind === 'prs' && input.cursor && !/^\d{1,9}$/.test(input.cursor))
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid cursor' });
      return (await ctx.tfs.client()).browse(input);
    }),
  connect: tfsProcedure
    .input(
      z
        .object({
          authType: z.enum(['ntlm', 'pat']),
          secret: z
            .string()
            .min(1)
            .max(4096)
            .refine((s) => !hasControlCharacter(s) && !s.includes('\n') && !s.includes('\r')),
          username: z
            .string()
            .trim()
            .max(255)
            .refine(
              (s) =>
                !hasControlCharacter(s) &&
                !s.includes('\n') &&
                !s.includes('\r') &&
                !s.includes(':'),
            ),
        })
        .refine((v) => v.authType === 'pat' || v.username.length > 0),
    )
    .mutation(({ ctx, input }) => ctx.tfs.connect(input)),
  detail: tfsProcedure
    .input(
      projectInput.extend({
        id,
        kind: z.enum(['prs', 'builds', 'releases']),
        repository: segment.optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      (await ctx.tfs.client()).detail(input.project, input.kind, input.id, input.repository),
    ),
  disconnect: tfsProcedure.mutation(({ ctx }) => ctx.tfs.disconnect()),
  log: tfsProcedure
    .input(
      projectInput.extend({
        buildId: id,
        logId: id,
        startLine: z.number().int().min(0).max(10_000_000),
      }),
    )
    .query(async ({ ctx, input }) =>
      (await ctx.tfs.client()).log(input.project, input.buildId, input.logId, input.startLine),
    ),
  projects: tfsProcedure
    .input(z.object({ cursor }).optional())
    .query(async ({ ctx, input }) => (await ctx.tfs.client()).projects(input?.cursor)),
  repositories: tfsProcedure
    .input(projectInput)
    .query(async ({ ctx, input }) => (await ctx.tfs.client()).repositories(input.project)),
  resolveRepository: tfsProcedure
    .input(z.object({ url: z.string().url().max(2000) }))
    .query(async ({ ctx, input }) => (await ctx.tfs.client()).resolveRepository(input.url)),
  status: tfsProcedure.query(({ ctx }) => ctx.tfs.status()),
  tfvcFile: tfsProcedure
    .input(projectInput.extend({ path: z.string().min(3).max(2000), version: id }))
    .query(async ({ ctx, input }) =>
      (await ctx.tfs.client()).tfvcFile(input.project, input.path, input.version),
    ),
});
