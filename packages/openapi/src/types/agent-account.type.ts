import { AGENT_ACCOUNT_KINDS } from '@lobechat/types';
import { z } from 'zod';

// ==================== Path / Query Schemas ====================

/** `/agents/:id` — the agent whose identity assets these are. */
export const AgentAccountAgentParamSchema = z.object({
  id: z.string().min(1),
});
export type AgentAccountAgentParam = z.infer<typeof AgentAccountAgentParamSchema>;

/** `/agents/:id/accounts/:accountId`. */
export const AgentAccountIdParamSchema = z.object({
  accountId: z.string().min(1),
  id: z.string().min(1),
});
export type AgentAccountIdParam = z.infer<typeof AgentAccountIdParamSchema>;

export const AgentAccountListQuerySchema = z.object({
  kind: z.enum(AGENT_ACCOUNT_KINDS).optional(),
  provider: z.string().min(1).optional(),
});
export type AgentAccountListQuery = z.infer<typeof AgentAccountListQuerySchema>;

/**
 * Query strings carry booleans as text, and `z.coerce.boolean()` would read the
 * string `"false"` as `true`. Only the two literals are accepted.
 */
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * Revocation knobs. Both default to `true`: a revoked identity must not keep a
 * usable secret behind it, and the provider should be told to release it.
 */
export const RevokeAgentAccountQuerySchema = z.object({
  purgeCredential: booleanQuery.optional(),
  release: booleanQuery.optional(),
});
export type RevokeAgentAccountQuery = z.infer<typeof RevokeAgentAccountQuerySchema>;

// ==================== Request Body Schemas ====================

export const AgentAccountCapabilitiesSchema = z.object({
  login: z.boolean().optional(),
  receive: z.boolean(),
  send: z.boolean(),
  sign: z.boolean().optional(),
});

/** Non-secret display facts. `rotatedAt` is stamped by the store, not the caller. */
export const AgentAccountCredentialHintSchema = z.object({
  expiresAt: z.string().optional(),
  masked: z.string().optional(),
  username: z.string().optional(),
});

/**
 * Mount an account whose handle the caller already holds — a `user`-provided
 * login, or one issued out of band. Takes no credential: a secret only ever
 * enters through the write-only credential sub-resource.
 */
const MountAgentAccountSchema = z.object({
  capabilities: AgentAccountCapabilitiesSchema.optional(),
  displayName: z.string().min(1).optional(),
  identifier: z.string().min(1),
  kind: z.enum(AGENT_ACCOUNT_KINDS),
  metadata: z.record(z.string(), z.unknown()).optional(),
  provider: z.string().min(1),
});

/** Ask a provider to issue a new account; the handle is not the caller's to choose. */
const ProvisionAgentAccountSchema = z.object({
  displayName: z.string().min(1).optional(),
  provider: z.string().min(1),
});

/**
 * `POST /agents/{id}/accounts` is one endpoint with two modes, discriminated by
 * `identifier`: with one, the caller is mounting a handle it already has;
 * without one, the named provider is asked to issue a brand-new account.
 */
export const CreateAgentAccountRequestSchema = z.union([
  MountAgentAccountSchema,
  ProvisionAgentAccountSchema,
]);
export type CreateAgentAccountRequest = z.infer<typeof CreateAgentAccountRequestSchema>;

/** The non-secret fields a caller may patch. `status` moves through revoke, not here. */
export const UpdateAgentAccountRequestSchema = z
  .object({
    capabilities: AgentAccountCapabilitiesSchema.optional(),
    displayName: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one of `displayName`, `capabilities` or `metadata`',
  });
export type UpdateAgentAccountRequest = z.infer<typeof UpdateAgentAccountRequestSchema>;

/**
 * The write-only credential body. Values are the secret's parts (`password`,
 * `token`, `apiKey`, …); they are encrypted at rest and never read back.
 */
export const SetAgentAccountCredentialRequestSchema = z.object({
  credential: z
    .record(z.string(), z.string())
    .refine((value) => Object.keys(value).length > 0, 'credential must not be empty'),
  hint: AgentAccountCredentialHintSchema.optional(),
});
export type SetAgentAccountCredentialRequest = z.infer<
  typeof SetAgentAccountCredentialRequestSchema
>;
