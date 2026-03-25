import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { SharedAgentModel } from '@/database/models/sharedAgent';
import { UserModel } from '@/database/models/user';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const sharedAgentInput = z.object({
  avatar: z.string().optional().nullable(),
  backgroundColor: z.string().optional().nullable(),
  chatConfig: z.object({}).passthrough().optional().nullable(),
  description: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
  model: z.string().optional().nullable(),
  openingMessage: z.string().optional().nullable(),
  openingQuestions: z.array(z.string()).optional(),
  params: z.object({}).passthrough().optional(),
  plugins: z.array(z.string()).optional().nullable(),
  provider: z.string().optional().nullable(),
  sort: z.number().optional(),
  systemRole: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  title: z.string().optional().nullable(),
  tts: z.object({}).passthrough().optional().nullable(),
});

const adminProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const user = await UserModel.findById(ctx.serverDB, ctx.userId);

  if (!user || user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }

  return opts.next({
    ctx: { sharedAgentModel: new SharedAgentModel(ctx.serverDB) },
  });
});

const readProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  return opts.next({
    ctx: { sharedAgentModel: new SharedAgentModel(opts.ctx.serverDB) },
  });
});

export const sharedAgentRouter = router({
  // Admin: create
  create: adminProcedure.input(sharedAgentInput).mutation(async ({ input, ctx }) => {
    return ctx.sharedAgentModel.create(input as any);
  }),

  // Admin: delete
  delete: adminProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    await ctx.sharedAgentModel.delete(input.id);
    return { success: true };
  }),

  // Admin: list all (including disabled)
  listAll: adminProcedure.query(async ({ ctx }) => {
    return ctx.sharedAgentModel.listAll();
  }),

  // Admin: toggle enabled
  toggleEnabled: adminProcedure
    .input(z.object({ enabled: z.boolean(), id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.sharedAgentModel.toggleEnabled(input.id, input.enabled);
    }),

  // Admin: update
  update: adminProcedure
    .input(z.object({ id: z.string(), value: sharedAgentInput }))
    .mutation(async ({ input, ctx }) => {
      return ctx.sharedAgentModel.update(input.id, input.value as any);
    }),

  // All users: list enabled shared agents
  list: readProcedure.query(async ({ ctx }) => {
    return ctx.sharedAgentModel.list();
  }),
});
