import { z } from 'zod';

/**
 * Text and structured-output (JSON) generation on the public REST API: one
 * completion, no tools, no conversation stored — what `lh generate text` and
 * `lh generate json` do. For agents, tools and history use `/responses`.
 */

const MessageSchema = z
  .object({
    content: z.string().describe('Plain-text message content.'),
    role: z.enum(['system', 'user', 'assistant']),
  })
  .strict();

const TextGenerationInputSchema = z
  .object({
    maxTokens: z.number().int().positive().optional().describe('Maximum output tokens.'),
    messages: z
      .array(MessageSchema)
      .min(1)
      .max(200)
      .optional()
      .describe('Conversation to complete. Use instead of, or after, `system` + `prompt`.'),
    model: z
      .string()
      .min(1)
      .optional()
      .describe("Model id. Omit to use the platform's default chat model."),
    prompt: z
      .string()
      .min(1)
      .optional()
      .describe('User prompt; appended after `messages` when both are given.'),
    provider: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Provider id (for example `lobehub`, `openai`). Omit with `model` for the default.',
      ),
    system: z.string().min(1).optional().describe('System prompt, placed first.'),
    temperature: z.number().min(0).max(2).optional().describe('Sampling temperature, 0–2.'),
  })
  .strict();

const needsInput = (v: { messages?: unknown[]; prompt?: string }) =>
  Boolean(v.prompt) || Boolean(v.messages?.length);
const needsInputIssue = {
  message: 'Provide `prompt` or `messages`',
  path: ['prompt'],
};

export const TextGenerationRequestSchema = TextGenerationInputSchema.refine(
  needsInput,
  needsInputIssue,
);

/** JSON Schema of the object to generate; the keys the model runtime honours. */
export const JsonObjectSchemaSchema = z
  .object({
    $defs: z.record(z.string(), z.unknown()).optional(),
    additionalProperties: z.boolean().optional(),
    description: z.string().optional(),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
    title: z.string().optional(),
    type: z.literal('object'),
  })
  .strict()
  .describe(
    'A JSON Schema with `type: "object"` at the root. Supported root keywords: `properties`, `required`, `additionalProperties`, `$defs`, `title`, `description`; others (such as `allOf`) are rejected rather than silently dropped.',
  );

export const ObjectGenerationRequestSchema = TextGenerationInputSchema.omit({
  maxTokens: true,
  temperature: true,
})
  .extend({
    schema: JsonObjectSchemaSchema,
    schemaDescription: z.string().optional().describe('What the object is, sent with the schema.'),
    schemaName: z
      .string()
      .regex(/^[\w-]{1,64}$/)
      .default('response')
      .describe('Name sent with the schema. Defaults to `response`.'),
    strict: z
      .boolean()
      .optional()
      .describe(
        'Ask the provider to enforce the schema strictly (every property required, no extras).',
      ),
  })
  .refine(needsInput, needsInputIssue);

export const TextGenerationUsageSchema = z.object({
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  reasoningTokens: z.number().int().nullable(),
  totalTokens: z.number().int().nullable(),
});

export const TextGenerationSchema = z.object({
  finishReason: z
    .string()
    .nullable()
    .describe('Why the model stopped, as the provider reports it (`stop`, `length`, …).'),
  model: z.string(),
  provider: z.string(),
  reasoning: z
    .string()
    .nullable()
    .describe('Reasoning of a reasoning model, kept out of `text`; `null` otherwise.'),
  text: z.string().describe('The generated text.'),
  usage: TextGenerationUsageSchema.nullable(),
});

export const ObjectGenerationSchema = z.object({
  model: z.string(),
  object: z
    .record(z.string(), z.unknown())
    .describe('The generated object, valid for the requested schema.'),
  provider: z.string(),
});

export type TextGenerationRequest = z.infer<typeof TextGenerationRequestSchema>;
export type ObjectGenerationRequest = z.infer<typeof ObjectGenerationRequestSchema>;
export type TextGeneration = z.infer<typeof TextGenerationSchema>;
export type ObjectGeneration = z.infer<typeof ObjectGenerationSchema>;
