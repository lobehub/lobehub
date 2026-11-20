import {
  AGENT_ACCOUNT_DIGEST_MINUTES_RANGE,
  AGENT_ACCOUNT_KINDS,
  AGENT_ACCOUNT_PERSISTED_KINDS,
  AGENT_ACCOUNT_STATUSES,
  AGENT_ACCOUNT_WAKE_MODES,
} from '@lobechat/types';
import { z } from 'zod';

import type { AgentAccountView } from '@/database/models/agentAccount';

import { dateTimeSchema, jsonObjectSchema } from './common.type';

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

/**
 * Ask a provider to issue a new account; the handle is not the caller's to
 * choose. Strict, so a malformed mount (say, `identifier` without `kind`)
 * fails validation instead of falling through to here with its mount-only
 * fields stripped and provisioning an identity nobody asked for.
 */
const ProvisionAgentAccountSchema = z
  .object({
    displayName: z.string().min(1).optional(),
    provider: z.string().min(1),
  })
  .strict();

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

// ==================== Response Schemas ====================

/**
 * Every field an account view carries. Typed against the view so a column added
 * to it fails type-checking here rather than being silently dropped from the
 * SDK — the schema is strict, so a missing field would also make strict
 * response validators reject real payloads.
 */
const agentAccountShape = {
  /** Last time the account was read or used — every account view carries it. */
  accessedAt: dateTimeSchema,
  agentId: z.string(),
  /** Stored JSON declared by the provider (or the mounting caller). */
  capabilities: z
    .object({
      login: z.boolean().optional(),
      receive: z.boolean(),
      send: z.boolean(),
      sign: z.boolean().optional(),
    })
    .meta({ id: 'AgentAccountCapabilities' }),
  createdAt: dateTimeSchema,
  /** Non-secret display facts about the installed credential. */
  credentialHint: z
    .object({
      expiresAt: z.string().optional(),
      masked: z.string().optional(),
      rotatedAt: z.string().optional(),
      username: z.string().optional(),
    })
    .nullable(),
  displayName: z.string().nullable(),
  /** Whether a secret is installed. Never the secret itself. */
  hasCredential: z.boolean(),
  id: z.string(),
  identifier: z.string(),
  // The persisted kinds, not just the creatable ones: an unfiltered read still
  // returns retired-kind rows, and the response contract must not exclude a
  // value the API actually returns.
  kind: z.enum(AGENT_ACCOUNT_PERSISTED_KINDS),
  /** Provider-side non-secret handles (inboxId, chatId, …), owned by the provider. */
  metadata: jsonObjectSchema.nullable(),
  provider: z.string(),
  revokedAt: dateTimeSchema.nullable(),
  /** The owner's own settings, such as wake rules. */
  settings: z.object({
    wake: z
      .object({
        digestMinutes: z
          .number()
          .int()
          .min(AGENT_ACCOUNT_DIGEST_MINUTES_RANGE.min)
          .max(AGENT_ACCOUNT_DIGEST_MINUTES_RANGE.max)
          .optional(),
        mode: z.enum(AGENT_ACCOUNT_WAKE_MODES).optional(),
        wakeSenders: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  status: z.enum(AGENT_ACCOUNT_STATUSES),
  updatedAt: dateTimeSchema,
  userId: z.string(),
  workspaceId: z.string().nullable(),
} satisfies Record<keyof AgentAccountView, z.ZodType>;

export const AgentAccountSchema = z.object(agentAccountShape).strict().meta({ id: 'AgentAccount' });

export const AgentAccountListSchema = z
  .object({ accounts: z.array(AgentAccountSchema), total: z.number().int().min(0) })
  .strict()
  .meta({ id: 'AgentAccountList' });
