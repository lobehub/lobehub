import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { GenerationController } from '../controllers/generation.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import {
  CreateVideoGenerationRequestSchema,
  GenerationBatchCreatedSchema,
} from '../types/generation.type';
import { GENERATION_EXAMPLE } from './generation.examples';

/**
 * Video generation. Generating spends model credits, so the caller needs the
 * model-invoke permission and API keys the `generation:write` scope.
 */
const VideoRoutes = new Hono();

const generationWrite = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AI_MODEL_INVOKE'),
  'generation:write',
  'You do not have permission to generate videos',
);

/** POST /api/v1/videos/generations */
VideoRoutes.post(
  '/generations',
  routeDoc({
    data: GenerationBatchCreatedSchema,
    description:
      'Starts a video generation and answers 202 with the generation id while it runs; videos take minutes. Poll `GET /generations/{id}` until the status is `success` or `error`, or call `generations.wait(id)` in the SDK. Billing and quota follow the Video page. Each request is added to `topicId`, or to a new generation topic. A request the plan or budget refuses (insufficient credits, plan limit) is recorded as a generation that already failed: it comes back with the status `error` and the reason in the `error` field.',
    errors: [400, 404],
    operationId: 'videos.generate',
    requestExample: example(CreateVideoGenerationRequestSchema, {
      aspectRatio: '16:9',
      duration: 5,
      model: 'seedance-1-0-pro',
      prompt: 'Waves rolling onto a beach at sunset, slow pan',
      provider: 'volcengine',
    }),
    responseExample: {
      batchId: GENERATION_EXAMPLE.batchId,
      generations: [
        {
          ...GENERATION_EXAMPLE,
          asset: null,
          fileId: null,
          model: 'seedance-1-0-pro',
          prompt: 'Waves rolling onto a beach at sunset, slow pan',
          provider: 'volcengine',
          status: 'pending',
          type: 'video',
        },
      ],
      topicId: GENERATION_EXAMPLE.topicId,
    },
    status: 202,
    summary: 'Generate a video',
    tags: ['videos'],
  }),
  requireAuth,
  generationWrite,
  zValidator('json', CreateVideoGenerationRequestSchema),
  async (c) => new GenerationController().createVideo(c),
);

export default VideoRoutes;
