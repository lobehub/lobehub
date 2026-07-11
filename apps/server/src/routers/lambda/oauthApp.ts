import { z } from 'zod';

import { OidcClientModel } from '@/database/models/oidcClient';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const oauthAppProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      oidcClientModel: new OidcClientModel(ctx.serverDB, ctx.userId),
    },
  });
});

const stripSecret = <T extends { clientSecret?: string | null }>(client: T) => {
  const { clientSecret: _clientSecret, ...rest } = client;
  return rest;
};

export const oauthAppRouter = router({
  create: oauthAppProcedure
    .input(
      z.object({
        description: z.string().optional(),
        logoUri: z.string().optional(),
        name: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const client = await ctx.oidcClientModel.create(input);
      return stripSecret(client);
    }),

  delete: oauthAppProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    return ctx.oidcClientModel.delete(input.id);
  }),

  getById: oauthAppProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
    const client = await ctx.oidcClientModel.findById(input.id);
    return client ? stripSecret(client) : undefined;
  }),

  list: oauthAppProcedure.query(async ({ ctx }) => {
    const clients = await ctx.oidcClientModel.list();
    return clients.map(stripSecret);
  }),

  setEnabled: oauthAppProcedure
    .input(z.object({ enabled: z.boolean(), id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.oidcClientModel.setEnabled(input.id, input.enabled);
    }),

  update: oauthAppProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          description: z.string().optional(),
          logoUri: z.string().optional(),
          name: z.string().min(1).optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.oidcClientModel.update(input.id, input.value);
    }),
});
