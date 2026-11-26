import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { GenerationController } from '../controllers/generation.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import { TextGenerationRequestSchema, TextGenerationSchema } from '../types/text-generation.type';

/**
 * One-shot text generation (`lh generate text`). Spends model credits: members
 * need the model-invoke permission, API keys `generation:write` (keys issued
 * with `model:invoke`, which `/chat` uses, are accepted too).
 */
const TextRoutes = new Hono();

const generationWrite = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AI_MODEL_INVOKE'),
  'generation:write',
  'You do not have permission to generate text',
  { legacyApiKeyScopes: ['model:invoke'] },
);

/** POST /api/v1/text/generations */
TextRoutes.post(
  '/generations',
  routeDoc({
    data: TextGenerationSchema,
    description:
      "Generates text with an LLM in a single completion — no tools, nothing stored as a conversation. Pass `prompt` (and optionally `system`), or a `messages` list. `model` + `provider` pick the model; omit both for the platform's default chat model. The answer is in `text`; a reasoning model's reasoning comes back separately in `reasoning`, never spliced into `text`. Provider failures answer 502 `upstream_error` with the provider's reason; budget and quota refusals keep their own status (402 / 429).",
    errors: [400, 402, 422, 429, 502],
    operationId: 'text.generate',
    requestExample: example(TextGenerationRequestSchema, {
      model: 'deepseek-flash',
      prompt: 'Name three uses for a pegboard in a home workshop.',
      provider: 'lobehub',
      system: 'Answer in one short sentence.',
    }),
    responseExample: {
      finishReason: 'stop',
      model: 'deepseek-flash',
      provider: 'lobehub',
      reasoning: null,
      text: 'Hanging hand tools, organising cables and storing small parts bins.',
      usage: { inputTokens: 24, outputTokens: 14, reasoningTokens: null, totalTokens: 38 },
    },
    summary: 'Generate text',
    tags: ['text'],
  }),
  requireAuth,
  generationWrite,
  zValidator('json', TextGenerationRequestSchema),
  async (c) => new GenerationController().generateText(c),
);

export default TextRoutes;
