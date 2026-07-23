import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { OidcClientModel } from '@/database/models/oidcClient';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const oauthAppProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      oidcClientModel: new OidcClientModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
    },
  });
});

const oauthAppWriteProcedure = oauthAppProcedure.use(requireWorkspaceRoleWhenScoped('owner'));

const stripSecret = <T extends { clientSecret?: string | null }>(client: T) => {
  const { clientSecret: _clientSecret, ...rest } = client;
  return rest;
};

export const oauthAppRouter = router({
  create: oauthAppWriteProcedure
    .input(
      z.object({
        description: z.string().max(500).optional(),
        logoUri: z.string().max(300_000).optional(),
        name: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const client = await ctx.oidcClientModel.create(input);
      return stripSecret(client);
    }),

  delete: oauthAppWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
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

  setEnabled: oauthAppWriteProcedure
    .input(z.object({ enabled: z.boolean(), id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.oidcClientModel.setEnabled(input.id, input.enabled);
    }),

  update: oauthAppWriteProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          description: z.string().max(500).optional(),
          logoUri: z.string().max(300_000).optional(),
          name: z.string().min(1).max(64).optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.oidcClientModel.update(input.id, input.value);
    }),
});
