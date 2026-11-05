import { z } from 'zod';

export const ConnectorIdSchema = z.object({ id: z.uuid() });
export const ConnectorSessionIdSchema = z.object({ sessionId: z.uuid() });
export const ConnectorAuthorizeSchema = z
  .object({
    providerId: z.string().min(1).max(100),
    requestId: z.uuid(),
    connectionId: z.uuid().optional(),
    adoptReadOnly: z.boolean().optional(),
  })
  .strict();
export const ConnectorAgentScopeSchema = z
  .object({
    agentIds: z.array(z.string().min(1).max(255)).max(200),
    revision: z.number().int().nonnegative(),
    adoptReadOnly: z.boolean().optional(),
    replacements: z
      .array(z.object({ id: z.uuid(), revision: z.number().int().nonnegative() }).strict())
      .max(200)
      .optional(),
  })
  .strict();
export const ConnectorDisconnectSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();

export const ConnectorProviderSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    available: z.boolean(),
    unavailableReason: z.string().optional(),
  })
  .strict();
export const ConnectorResponseSchema = z
  .object({
    id: z.string(),
    providerId: z.string(),
    name: z.string(),
    agentId: z.string().nullable(),
    status: z.enum([
      'authorizing',
      'ready',
      'disconnected',
      'expired',
      'permission_required',
      'sync_failed',
      'unavailable',
      'disconnecting',
      'disconnect_failed',
    ]),
    managed: z.boolean(),
    isEnabled: z.boolean(),
    revision: z.number(),
    agentIds: z.array(z.string()),
    accountLabel: z.string().optional(),
    grantedScopes: z.array(z.string()).nullable(),
    lastError: z.string().optional(),
    authorization: z
      .object({
        id: z.string(),
        expiresAt: z.number(),
        status: z.enum(['pending', 'complete', 'cancelled', 'expired', 'unknown']),
        url: z.string().optional(),
      })
      .optional(),
    reading: z.enum(['unverified', 'verified']),
    accessRevision: z.number(),
    activeAgentIds: z.array(z.string()),
    reads: z.array(
      z.object({
        agentId: z.string(),
        at: z.number(),
        connectionId: z.string(),
        operationId: z.string().optional(),
        outcome: z.enum(['data', 'empty', 'unverified', 'failed']),
        recordCount: z.number(),
        revision: z.number(),
        toolCallId: z.string(),
        toolName: z.string(),
        topicId: z.string(),
      }),
    ),
  })
  .strict();
export const ConnectorDisconnectResponseSchema = z
  .object({
    connection: ConnectorResponseSchema.nullable(),
    localDisabled: z.boolean(),
    remoteDisconnected: z.boolean(),
  })
  .strict();
export const connectorSuccess = <T extends z.ZodType>(data: T) =>
  z.object({
    data,
    success: z.literal(true),
    timestamp: z.string(),
    message: z.string().optional(),
  });
