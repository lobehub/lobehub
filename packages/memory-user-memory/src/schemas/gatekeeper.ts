import { z } from 'zod';

/**
 * Memory layer decision schema
 */
export const LayerDecisionSchema = z.object({
  reasoning: z.string(),
  shouldExtract: z.boolean(),
});

export type LayerDecision = z.infer<typeof LayerDecisionSchema>;

/**
 * Gatekeeper result schema for memory layers
 */
export const GatekeeperResultSchema = z.object({
  context: LayerDecisionSchema,
  experience: LayerDecisionSchema,
  identity: LayerDecisionSchema,
  preference: LayerDecisionSchema,
});

export type GatekeeperResult = z.infer<typeof GatekeeperResultSchema>;
