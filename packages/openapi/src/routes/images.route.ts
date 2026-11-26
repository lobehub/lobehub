import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { GenerationController } from '../controllers/generation.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import {
  CreateImageGenerationRequestSchema,
  GenerationBatchCreatedSchema,
} from '../types/generation.type';
import { GENERATION_EXAMPLE } from './generation.examples';

/**
 * Image generation. Generating spends model credits, so the caller needs the
 * model-invoke permission and API keys the `generation:write` scope.
 */
const ImageRoutes = new Hono();

const generationWrite = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AI_MODEL_INVOKE'),
  'generation:write',
  'You do not have permission to generate images',
);

/** POST /api/v1/images/generations */
ImageRoutes.post(
  '/generations',
  routeDoc({
    data: GenerationBatchCreatedSchema,
    description:
      "Generates `n` images from a prompt with an image model (the account's default when `model` is omitted). Billing and quota follow the Image page. By default the request waits up to `waitTimeoutSeconds` and returns the finished images with their URLs; any still running come back with their current status — poll `GET /generations/{id}` or call `generations.wait(id)` in the SDK. With `wait: false` it answers as soon as the work is queued. Each request is added to `topicId`, or to a new generation topic. A request the plan or budget refuses (insufficient credits, plan limit) is recorded as generations that already failed: they come back with `status: 'error'` and the reason in `error`, as on the Image page.",
    errors: [400, 404],
    operationId: 'images.generate',
    requestExample: example(CreateImageGenerationRequestSchema, {
      model: 'gpt-image-1',
      n: 1,
      prompt: 'A lighthouse on a cliff at dawn, watercolor',
      provider: 'openai',
    }),
    responseExample: {
      batchId: GENERATION_EXAMPLE.batchId,
      generations: [GENERATION_EXAMPLE],
      topicId: GENERATION_EXAMPLE.topicId,
    },
    summary: 'Generate images',
    tags: ['images'],
  }),
  requireAuth,
  generationWrite,
  zValidator('json', CreateImageGenerationRequestSchema),
  async (c) => new GenerationController().createImages(c),
);

export default ImageRoutes;
