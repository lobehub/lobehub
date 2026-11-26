import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { GenerationController } from '../controllers/generation.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import {
  ObjectGenerationRequestSchema,
  ObjectGenerationSchema,
} from '../types/text-generation.type';

/**
 * Structured output (`lh generate json`): the model answers with an object that
 * matches a JSON Schema. Same permissions as text generation.
 */
const ObjectRoutes = new Hono();

const generationWrite = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AI_MODEL_INVOKE'),
  'generation:write',
  'You do not have permission to generate objects',
  { legacyApiKeyScopes: ['model:invoke'] },
);

/** POST /api/v1/objects/generations */
ObjectRoutes.post(
  '/generations',
  routeDoc({
    data: ObjectGenerationSchema,
    description:
      'Generates a JSON object that matches `schema` (structured output, single completion) — the same path `lh generate json` uses. The root of `schema` must be `type: "object"`; `strict: true` asks providers that support it to enforce the schema exactly (every property required, `additionalProperties: false`). `model` + `provider` pick the model; omit both for the platform\'s default. A reply that is not a JSON object for the schema answers 422 `unprocessable_entity`; provider failures answer 502 `upstream_error`.',
    errors: [400, 402, 422, 429, 502],
    operationId: 'objects.generate',
    requestExample: example(ObjectGenerationRequestSchema, {
      model: 'deepseek-flash',
      prompt: 'A pegboard headphone hanger, 3D printed in PETG.',
      provider: 'lobehub',
      schema: {
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          steps: { items: { type: 'string' }, type: 'array' },
        },
        required: ['name', 'steps'],
        type: 'object',
      },
      schemaName: 'concept',
      strict: true,
      system: 'Propose one product concept with its CAD modelling steps.',
    }),
    responseExample: {
      model: 'deepseek-flash',
      object: { name: 'Peg hook', steps: ['Sketch the side profile', 'Extrude 40 mm', 'Fillet'] },
      provider: 'lobehub',
    },
    summary: 'Generate a JSON object',
    tags: ['objects'],
  }),
  requireAuth,
  generationWrite,
  zValidator('json', ObjectGenerationRequestSchema),
  async (c) => new GenerationController().generateObject(c),
);

export default ObjectRoutes;
