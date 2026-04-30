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
export const SUGGESTION_RESPONSE_JSON_SCHEMA = {
  name: 'follow_up_suggestions',
  strict: true,
  schema: {
    additionalProperties: false,
    type: 'object',
    required: ['chips'],
    properties: {
      chips: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'message'],
          properties: {
            label: { type: 'string', minLength: 1, maxLength: 40 },
            message: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
  },
} as const;
