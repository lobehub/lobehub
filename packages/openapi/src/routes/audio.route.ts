import { Hono } from 'hono';
import type { DescribeRouteOptions } from 'hono-openapi';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { AudioController } from '../controllers/audio.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';

type RouteResponse = NonNullable<DescribeRouteOptions['responses']>[string];

/** Synthesis errors use OpenAI's error body, so OpenAI SDKs surface the message. */
const openAIError = (description: string): RouteResponse => ({
  content: {
    'application/json': {
      schema: {
        properties: {
          error: {
            properties: {
              code: { type: ['string', 'null'] },
              message: { type: 'string' },
              param: { type: ['string', 'null'] },
              type: { type: 'string' },
            },
            required: ['message', 'type'],
            type: 'object',
          },
        },
        required: ['error'],
        type: 'object',
      },
    },
  },
  description,
});

const app = new Hono();
// Synthesis spends model credits: API keys need `model:invoke`, members the invoke permission.
const requireModelInvoke = requireAnyPermission(getAllScopePermissions('AI_MODEL_INVOKE'));

app.post(
  '/speech',
  describeRoute({
    description:
      'OpenAI-compatible text-to-speech. Point an OpenAI SDK at `/api/v1` and call `audio.speech.create`. ' +
      '`model` takes `provider/model` (for example `lobehub/speech-2.8-hd`) or a bare model id; ' +
      'the optional `provider` and `params` (emotion, pitch, volume, sampleRate) are LobeHub extensions. ' +
      'Returns the audio bytes; usage is reported in `X-LobeHub-*` headers. ' +
      "Synthesis errors use OpenAI's `{ error: { message, type, code, param } }` body; " +
      'authentication and permission errors use the platform `ApiError` envelope.',
    responses: {
      200: {
        content: {
          'audio/aac': { schema: { format: 'binary', type: 'string' } },
          'audio/mpeg': { schema: { format: 'binary', type: 'string' } },
          'audio/opus': { schema: { format: 'binary', type: 'string' } },
        },
        description: 'Synthesized audio',
      },
      400: openAIError('Invalid request, unsupported format or invalid params'),
      402: openAIError('Insufficient credits'),
      429: openAIError('Upstream provider rate limit'),
      502: openAIError('Upstream provider error'),
    },
    summary: 'Create speech',
    tags: ['audio'],
  }),
  requireAuth,
  requireModelInvoke,
  async (c) => new AudioController().handleSpeech(c),
);

export default app;
