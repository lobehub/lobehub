import { Hono } from 'hono';
import type { DescribeRouteOptions } from 'hono-openapi';
import { describeRoute, resolver } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { errorResponse, routeDoc } from '../common/openapi';
import { AudioController } from '../controllers/audio.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import { SpeechRequestSchema } from '../types/audio.type';
import {
  MAX_TRANSCRIPTION_UPLOAD_BYTES,
  TRANSCRIPTION_FORMATS,
  TranscriptionSchema,
} from '../types/generation.type';

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
// The success body is the audio bytes, not JSON, which `routeDoc` (JSON-only)
// cannot express — so this route declares its responses with `describeRoute`.
// Synthesis and transcription spend model credits: members need the invoke
// permission, API keys `generation:write`. Speech shipped gated by
// `model:invoke`, so keys issued with that scope keep working there.
const requireSpeechGeneration = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AI_MODEL_INVOKE'),
  'generation:write',
  'You do not have permission to synthesize speech',
  { legacyApiKeyScopes: ['model:invoke'] },
);
const requireTranscriptionGeneration = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AI_MODEL_INVOKE'),
  'generation:write',
);

app.post(
  '/speech',
  describeRoute({
    description:
      'OpenAI-compatible text-to-speech. Point an OpenAI SDK at `/api/v1` and call `audio.speech.create`. ' +
      '`model` takes `provider/model` (for example `lobehub/speech-2.8-hd`) or a bare model id; ' +
      'the optional `provider` and `params` (emotion, pitch, volume, sampleRate) are LobeHub extensions. ' +
      'Returns the audio bytes; usage is reported in `X-LobeHub-*` headers. ' +
      'API keys need the `generation:write` scope (keys issued with `model:invoke` are also accepted). ' +
      "Synthesis errors use OpenAI's `{ error: { message, type, code, param } }` body; " +
      'authentication and permission errors use the platform `ApiError` envelope.',
    // The handler validates the body itself (to answer OpenAI-shaped errors),
    // so the schema is declared here rather than through `zValidator`.
    requestBody: {
      content: { 'application/json': { schema: resolver(SpeechRequestSchema) as never } },
      required: true,
    },
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
      // Raised by `requireAuth` / the permission gate before the handler runs.
      401: errorResponse(401),
      402: openAIError('Insufficient balance'),
      403: errorResponse(403),
      429: openAIError('Upstream provider rate limit'),
      500: openAIError('Text-to-speech failed'),
      502: openAIError('Upstream provider error'),
    },
    summary: 'Create speech',
    tags: ['audio'],
  }),
  requireAuth,
  requireSpeechGeneration,
  async (c) => new AudioController().handleSpeech(c),
);

app.post(
  '/transcriptions',
  routeDoc({
    data: TranscriptionSchema,
    description:
      'OpenAI-compatible speech-to-text: upload the audio as multipart/form-data and get `{ text }` back, so an OpenAI SDK pointed at `/api/v1` can call `audio.transcriptions.create`. ' +
      `Send the clip as \`file\` (up to ${MAX_TRANSCRIPTION_UPLOAD_BYTES / 1024 / 1024} MB), or the id of an uploaded file as \`fileId\` (the key then also needs \`file:read\`). ` +
      '`provider` (default `openai`) is a LobeHub extension. Billing follows the provider configuration, like the in-app voice input. ' +
      'The transcript is always returned as JSON `{ text }`, whatever `response_format` asks of the provider.',
    envelope: false,
    errors: [400, 404, 413, 502],
    operationId: 'audio.createTranscription',
    requestBody: {
      content: {
        'multipart/form-data': {
          schema: {
            properties: {
              file: { description: 'The audio clip.', format: 'binary', type: 'string' },
              fileId: { description: 'An uploaded audio file, instead of `file`.', type: 'string' },
              language: { description: 'ISO-639-1 language code, e.g. `en`.', type: 'string' },
              model: { description: 'Transcription model, e.g. `whisper-1`.', type: 'string' },
              prompt: { description: "Text to guide the model's style.", type: 'string' },
              provider: { description: 'Provider id; defaults to `openai`.', type: 'string' },
              response_format: { enum: [...TRANSCRIPTION_FORMATS], type: 'string' },
            },
            required: ['model'],
            type: 'object',
          },
        },
      },
      required: true,
    },
    responseExample: { text: 'Remind me to water the plants at six.' },
    summary: 'Create a transcription',
    tags: ['audio'],
  }),
  requireAuth,
  requireTranscriptionGeneration,
  async (c) => new AudioController().handleTranscription(c),
);

export default app;
