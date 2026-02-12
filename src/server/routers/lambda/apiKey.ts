import { z } from 'zod';

import { ApiKeyModel } from '@/database/models/apiKey';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

const apiKeyProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

  return opts.next({
    ctx: {
      apiKeyModel: new ApiKeyModel(ctx.serverDB, ctx.userId),
      gateKeeper,
    },
  });
});

export const apiKeyRouter = router({
  createApiKey: apiKeyProcedure
    .input(
      z.object({
        expiresAt: z.date().optional().nullable(),
        name: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await ctx.apiKeyModel.create(input, ctx.gateKeeper.encrypt);
    }),

  deleteAllApiKeys: apiKeyProcedure.mutation(async ({ ctx }) => {
    return ctx.apiKeyModel.deleteAll();
  }),

  deleteApiKey: apiKeyProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.apiKeyModel.delete(input.id);
    }),

  getApiKey: apiKeyProcedure
    .input(z.object({ apiKey: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.findByKey(input.apiKey, ctx.gateKeeper.encrypt);
    }),

  getApiKeyById: apiKeyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.findById(input.id);
    }),

  getApiKeys: apiKeyProcedure.query(async ({ ctx }) => {
    return ctx.apiKeyModel.query(ctx.gateKeeper.decrypt);
  }),

  updateApiKey: apiKeyProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          description: z.string().optional(),
          enabled: z.boolean().optional(),
          expiresAt: z.date().optional().nullable(),
          name: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.apiKeyModel.update(input.id, input.value);
    }),

  validateApiKey: apiKeyProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.validateKey(input.key);
    }),
});
