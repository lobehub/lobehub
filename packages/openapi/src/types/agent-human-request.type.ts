import {
  AGENT_HUMAN_REQUEST_STATUSES,
  AGENT_HUMAN_REQUEST_SURFACES,
  AGENT_HUMAN_REQUEST_TYPES,
} from '@lobechat/types';
import { z } from 'zod';

export const AgentHumanRequestIdParamSchema = z.object({
  id: z.string().min(1),
});
export type AgentHumanRequestIdParam = z.infer<typeof AgentHumanRequestIdParamSchema>;

/** `status` is a comma-separated list in the query string: `?status=pending,failed`. */
const statusListQuery = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(AGENT_HUMAN_REQUEST_STATUSES)))
  .optional();

export const AgentHumanRequestListQuerySchema = z.object({
  agentId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: statusListQuery,
  topicId: z.string().optional(),
  type: z.enum(AGENT_HUMAN_REQUEST_TYPES).optional(),
});
export type AgentHumanRequestListQuery = z.infer<typeof AgentHumanRequestListQuerySchema>;

/** The ASC/1 envelope, bounded the way the protocol bounds it (spec §6.8). */
export const AgentSecretEnvelopeSchema = z
  .object({
    ct: z.string().min(1).max(8192),
    enc: z.string().min(1).max(64),
    requestId: z.string().min(1).max(64),
    sender: z.string().max(128).optional(),
    suite: z.string().min(1).max(128),
    v: z.number().int(),
  })
  .strict();

export const AgentHumanRequestDecisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    edits: z
      .object({
        subject: z.string().max(998).optional(),
        text: z.string().min(1).max(20_000).optional(),
        to: z.string().min(1).max(320).optional(),
      })
      .strict()
      .optional(),
  }),
  z.object({ action: z.literal('decline') }),
  z.object({ action: z.literal('retry') }),
  z.object({ action: z.literal('fulfill'), envelope: AgentSecretEnvelopeSchema }),
]);

export const AgentHumanRequestDecideRequestSchema = z.object({
  decision: AgentHumanRequestDecisionSchema,
  /** Which surface the owner answered on, for the audit trail. */
  via: z.enum(AGENT_HUMAN_REQUEST_SURFACES).optional(),
});
export type AgentHumanRequestDecideRequest = z.infer<typeof AgentHumanRequestDecideRequestSchema>;
