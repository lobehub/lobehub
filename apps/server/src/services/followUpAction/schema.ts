import { z } from 'zod';

/**
 * Lenient schemas used to parse raw LLM output.
 * Length validation is performed manually in the service layer so individual
 * malformed chips can be dropped without rejecting the whole response.
 */
export const RawChipSchema = z.object({
  label: z.string(),
  message: z.string(),
});

export const RawResponseSchema = z.object({
  chips: z.array(RawChipSchema),
});
