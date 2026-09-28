import {
  MAX_OAUTH_REDIRECT_URIS,
  normalizeRedirectUris,
  validateRedirectUri,
} from '@lobechat/utils/oauthApp';
import { TRPCError } from '@trpc/server';
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

const oauthAppWriteProcedure = oauthAppProcedure.use(requireWorkspaceRoleWhenScoped('admin'));

/**
 * The stored secret is encrypted and is never a useful thing to ship to a
 * browser, so every read path replaces it with a boolean. The plaintext is
 * returned exactly once, by `create` and `rotateSecret`.
 */
const stripSecret = <T extends { clientSecret?: string | null }>(client: T) => {
  const { clientSecret, ...rest } = client;
  return { ...rest, hasSecret: !!clientSecret };
};

/**
 * A logo must be a web URL: it becomes the OIDC client's `logo_uri`, and
 * oidc-provider rejects the whole client as `invalid_client_metadata` when that
 * is anything else, such as an inline `data:` image.
 */
const logoUriSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === 'https:' || protocol === 'http:';
    } catch {
      return false;
    }
  }, 'logoUri.notWebUrl');

const redirectUrisSchema = z
  .array(z.string().max(2000))
  .max(MAX_OAUTH_REDIRECT_URIS)
  .transform(normalizeRedirectUris)
  .superRefine((uris, ctx) => {
    // An authorization-code client with no callback can never complete a login,
    // so a list that normalizes to empty is rejected wherever one is supplied.
    if (uris.length === 0) ctx.addIssue({ code: 'custom', message: 'redirectUri.required' });

    for (const uri of uris) {
      const issue = validateRedirectUri(uri);
      if (issue) ctx.addIssue({ code: 'custom', message: `redirectUri.${issue}`, params: { uri } });
    }
  });

export const oauthAppRouter = router({
  create: oauthAppWriteProcedure
    .input(
      // Redirect URIs are configured on the app page after creation, so a web
      // app may start with none; it simply cannot complete a login until one is
      // added, and the provider refuses any unregistered redirect in the meantime.
      z.object({
        description: z.string().max(500).optional(),
        logoUri: logoUriSchema.optional(),
        name: z.string().min(1).max(64),
        redirectUris: redirectUrisSchema.optional(),
        type: z.enum(['device', 'web']).default('device'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { client, secret } = await ctx.oidcClientModel.create(input);

      // The only time the plaintext secret ever leaves the server.
      return { ...stripSecret(client), clientSecret: secret };
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

  rotateSecret: oauthAppWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const clientSecret = await ctx.oidcClientModel.rotateSecret(input.id);

      if (!clientSecret) throw new TRPCError({ code: 'NOT_FOUND' });

      return { clientSecret };
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
          // `null` removes the logo.
          logoUri: logoUriSchema.nullable().optional(),
          name: z.string().min(1).max(64).optional(),
          redirectUris: redirectUrisSchema.optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.oidcClientModel.update(input.id, input.value);
    }),
});
