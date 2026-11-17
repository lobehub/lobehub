import { z } from 'zod';

import { paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema } from './common.type';

/**
 * `color` is rendered straight into an inline style by the product, so it is a
 * hex literal only — the same rule as the `agentLabel` tRPC router.
 */
const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i, 'color must be a hex literal like #1677ff');

export const AgentLabelIdParamSchema = z.object({
  id: z.string().min(1, 'Label ID cannot be empty'),
});

export const CreateAgentLabelRequestSchema = z
  .object({
    color: hexColor.optional(),
    description: z.string().max(500).optional(),
    name: z.string().trim().min(1, 'Label name cannot be empty').max(100),
  })
  .strict();

export const UpdateAgentLabelRequestSchema = z
  .object({
    /** Archived labels stay on the agents that carry them but cannot be newly assigned. */
    archived: z.boolean().optional(),
    color: hexColor.nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    name: z.string().trim().min(1, 'Label name cannot be empty').max(100).optional(),
  })
  .strict();

export type CreateAgentLabelRequest = z.infer<typeof CreateAgentLabelRequestSchema>;
export type UpdateAgentLabelRequest = z.infer<typeof UpdateAgentLabelRequestSchema>;

export const AgentLabelSchema = z
  .object({
    archived: z.boolean(),
    color: z.string().nullable(),
    createdAt: dateTimeSchema,
    description: z.string().nullable(),
    id: z.string(),
    name: z.string(),
    updatedAt: dateTimeSchema,
    /** Agents visible to the caller that carry this label. */
    usageCount: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'AgentLabel' });

export type PublicAgentLabel = z.infer<typeof AgentLabelSchema>;

export const AgentLabelListSchema = paginatedListSchema(AgentLabelSchema, { total: true }).meta({
  id: 'AgentLabelList',
});

/** The labels on one agent — bounded, so not paginated. */
export const AgentLabelSetSchema = z
  .object({ items: z.array(AgentLabelSchema) })
  .strict()
  .meta({ id: 'AgentLabelSet' });
