import { MAX_OAUTH_REDIRECT_URIS } from '@lobechat/utils/oauthApp';
import { z } from 'zod';

import { paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema } from './common.type';

/**
 * Field shapes only. The redirect-URI rules (https outside loopback, no
 * wildcard / fragment / credentials, de-duplication) and the logo URL rule are
 * enforced by the shared `oauthApp` procedures this API calls, so the REST and
 * in-app paths can never drift apart; a URI they refuse answers 400 with the
 * reason, e.g. `redirectUri.insecure` or `scope.notAllowed`.
 */
const NameSchema = z.string().min(1).max(64).describe('Display name shown on the consent screen.');
const DescriptionSchema = z.string().max(500).describe('What the application does.');
const LogoUriSchema = z
  .string()
  .max(2048)
  .describe('An http(s) URL of the logo shown on the consent screen.');
const RedirectUrisSchema = z
  .array(z.string().max(2000))
  .max(MAX_OAUTH_REDIRECT_URIS)
  .describe(
    `Exact-match callback URLs, at most ${MAX_OAUTH_REDIRECT_URIS}. Each must be an absolute https URL (http only for localhost) without wildcard, fragment or credentials. Web apps only; ignored for device apps.`,
  );

const ScopesSchema = z
  .array(z.string().max(64))
  .min(1)
  .max(64)
  .describe(
    'The scopes the app may request, replacing the registered list: the OIDC scopes `openid`, `profile`, `email` and `offline_access`, plus, when the server enables API scopes (`OIDC_ENABLE_API_SCOPES`), API key scopes such as `agent:read`. Full access (`*`) is never an OAuth scope. Defaults to the four OIDC scopes. A scope outside that list answers 400 (`scope.notAllowed`, or `scope.apiScopesDisabled` for an API scope the server does not offer).',
  );

export const OAuthAppTypeSchema = z
  .enum(['device', 'web'])
  .describe(
    '`device`: a public client using the device authorization flow (CLIs, headless devices; no secret). `web`: a confidential client using the authorization-code flow with a client secret.',
  );

export const OAuthAppIdParamSchema = z.object({
  id: z.string().min(1).describe('The application client id (`lca_…`).'),
});

export const OAuthAppListQuerySchema = z.object({
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe("Opaque cursor from the previous page's `nextCursor`. Omit for the first page."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Page size, 1–100. Defaults to 20.'),
});

export const CreateOAuthAppRequestSchema = z
  .object({
    description: DescriptionSchema.optional(),
    issueSecret: z
      .boolean()
      .default(true)
      .describe(
        'Web apps only: issue the client secret now and return it once in this response. `false` defers it to `POST /oauth-apps/{id}/rotate-secret`.',
      ),
    logoUri: LogoUriSchema.optional(),
    name: NameSchema,
    redirectUris: RedirectUrisSchema.optional(),
    scopes: ScopesSchema.optional(),
    type: OAuthAppTypeSchema.default('device'),
  })
  .strict();

export const UpdateOAuthAppRequestSchema = z
  .object({
    description: DescriptionSchema.optional(),
    enabled: z
      .boolean()
      .optional()
      .describe(
        '`false` disables the app: nobody can sign in through it and its tokens cannot be refreshed until it is enabled again.',
      ),
    logoUri: LogoUriSchema.nullable().optional().describe('`null` removes the logo.'),
    name: NameSchema.optional(),
    redirectUris: RedirectUrisSchema.optional(),
    scopes: ScopesSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const OAuthAppSchema = z
  .object({
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    enabled: z.boolean(),
    grants: z.array(z.string()).describe('OAuth grant types the client may use.'),
    hasSecret: z
      .boolean()
      .describe('Whether a client secret has been issued. The secret itself is never returned.'),
    id: z.string().describe('The client id (`lca_…`).'),
    lastUsedAt: dateTimeSchema.nullable(),
    logoUri: z.string().nullable(),
    name: z.string(),
    redirectUris: z.array(z.string()),
    scopes: z
      .array(z.string())
      .describe('Scopes the client may request: OIDC scopes and any API scopes it registered.'),
    tokenEndpointAuthMethod: z
      .string()
      .nullable()
      .describe('`none` for device apps, `client_secret_post` for web apps.'),
    type: OAuthAppTypeSchema,
    updatedAt: dateTimeSchema,
    workspaceId: z
      .string()
      .nullable()
      .describe('The workspace that owns the app; `null` for a personal app.'),
  })
  .strict()
  .meta({ id: 'OAuthApp' });

export const CreatedOAuthAppSchema = OAuthAppSchema.extend({
  clientSecret: z
    .string()
    .nullable()
    .describe(
      'The plaintext client secret, returned only here and by `rotate-secret`. `null` for device apps and for web apps created with `issueSecret: false`.',
    ),
})
  .strict()
  .meta({ id: 'CreatedOAuthApp' });

export const OAuthAppListSchema = paginatedListSchema(OAuthAppSchema, { total: true });

export const OAuthAppSecretSchema = z
  .object({
    clientSecret: z.string().describe('The new plaintext secret. It is not shown again.'),
    id: z.string(),
  })
  .strict()
  .meta({ id: 'OAuthAppSecret' });

export type OAuthApp = z.infer<typeof OAuthAppSchema>;
export type CreatedOAuthApp = z.infer<typeof CreatedOAuthAppSchema>;
export type OAuthAppListQuery = z.infer<typeof OAuthAppListQuerySchema>;
export type CreateOAuthAppRequest = z.infer<typeof CreateOAuthAppRequestSchema>;
export type UpdateOAuthAppRequest = z.infer<typeof UpdateOAuthAppRequestSchema>;
