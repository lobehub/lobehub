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
 * Models sometimes answer a layer with a bare yes/no, or leave a layer out (notably the retired
 * experience one). Read those as the decision they state, a missing one as "do not extract",
 * rather than failing the whole topic.
 */
const toLayerDecision = (value: unknown) => {
  if (value === undefined || value === null) return { reasoning: '', shouldExtract: false };
  if (typeof value === 'boolean') return { reasoning: '', shouldExtract: value };
  if (typeof value === 'string') {
    return { reasoning: value, shouldExtract: value.trim().toLowerCase() === 'true' };
  }
  return value;
};

const LenientLayerDecisionSchema = z.preprocess(toLayerDecision, LayerDecisionSchema);

/**
 * Gatekeeper result schema for memory layers
 */
export const GatekeeperResultSchema = z.object({
  activity: LenientLayerDecisionSchema,
  context: LenientLayerDecisionSchema,
  experience: LenientLayerDecisionSchema,
  identity: LenientLayerDecisionSchema,
  preference: LenientLayerDecisionSchema,
});

export type GatekeeperResult = z.infer<typeof GatekeeperResultSchema>;
