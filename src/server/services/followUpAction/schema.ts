import { z } from 'zod';

export const ChipSchema = z.object({
  label: z.string().min(1).max(40),
  message: z.string().min(1).max(200),
});

export const SuggestionResponseSchema = z.object({
  chips: z.array(ChipSchema).max(8), // accept up to 8 from LLM; service truncates to 4
});

export type SuggestionResponse = z.infer<typeof SuggestionResponseSchema>;

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
