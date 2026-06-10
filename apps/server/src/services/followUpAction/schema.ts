import type { GenerateObjectSchema } from '@lobechat/model-runtime';
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

/** JSON schema form for LLM structured-output binding */
export const SUGGESTION_RESPONSE_JSON_SCHEMA: GenerateObjectSchema = {
  name: 'follow_up_suggestions',
  schema: {
    additionalProperties: false,
    properties: {
      chips: {
        items: {
          additionalProperties: false,
          properties: {
            label: { maxLength: 40, minLength: 1, type: 'string' },
            message: { maxLength: 200, minLength: 1, type: 'string' },
          },
          required: ['label', 'message'],
          type: 'object',
        },
        maxItems: 8,
        type: 'array',
      },
    },
    required: ['chips'],
    type: 'object',
  },
  strict: true,
};
