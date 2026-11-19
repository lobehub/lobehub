import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ModelController } from '../controllers';
import { AiInfraOpsController } from '../controllers/ai-infra-ops.controller';
import { requireAuth } from '../middleware';
import {
  requireAnyPermission,
  requireAnyPermissionWithApiKeyScope,
} from '../middleware/permission-check';
import { requireWorkspaceRoleWhenScoped } from '../middleware/workspace';
import { DeletedResourceSchema } from '../types/common.type';
import {
  CreateModelRequestSchema,
  ModelIdParamSchema,
  ModelListSchema,
  ModelSchema,
  ModelsListQuerySchema,
  UpdateModelRequestSchema,
} from '../types/model.type';
import {
  BATCH_MODELS_REQUEST_EXAMPLE,
  BatchModelsRequestSchema,
  BatchModelsResultSchema,
  ModelReasoningConfigResultSchema,
  ModelReasoningConfigSchema,
  REASONING_CONFIG_REQUEST_EXAMPLE,
  REORDER_MODELS_REQUEST_EXAMPLE,
  ReorderModelsRequestSchema,
  ReorderModelsResultSchema,
} from '../types/model-ops.type';

// Models-related routes
const ModelRoutes = new Hono();

// GET /api/v1/models - Get model list (supports pagination, filtering, and grouping)
ModelRoutes.get(
  '/',
  routeDoc({ data: ModelListSchema, summary: 'List models', tags: ['models'] }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_MODEL_READ'),
    'You do not have permission to view model list',
  ),
  zValidator('query', ModelsListQuerySchema),
  (c) => {
    const controller = new ModelController();
    return controller.handleGetModels(c);
  },
);

// POST /api/v1/models - Create a model
ModelRoutes.post(
  '/',
  routeDoc({ data: ModelSchema, summary: 'Create a model', tags: ['models'] }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_MODEL_CREATE'),
    'You do not have permission to create a model',
  ),
  zValidator('json', CreateModelRequestSchema),
  (c) => {
    const controller = new ModelController();
    return controller.handleCreateModel(c);
  },
);

// GET /api/v1/models/:providerId/:modelId - Get model details
ModelRoutes.get(
  '/:providerId/:modelId',
  routeDoc({ data: ModelSchema, errors: [404], summary: 'Get a model', tags: ['models'] }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_MODEL_READ'),
    'You do not have permission to view model details',
  ),
  zValidator('param', ModelIdParamSchema),
  (c) => {
    const controller = new ModelController();
    return controller.handleGetModel(c);
  },
);

// PATCH /api/v1/models/:providerId/:modelId - Update a model
ModelRoutes.patch(
  '/:providerId/:modelId',
  routeDoc({ data: ModelSchema, errors: [404], summary: 'Update a model', tags: ['models'] }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_MODEL_UPDATE'),
    'You do not have permission to update a model',
  ),
  zValidator('param', ModelIdParamSchema),
  zValidator('json', UpdateModelRequestSchema),
  (c) => {
    const controller = new ModelController();
    return controller.handleUpdateModel(c);
  },
);

// POST /api/v1/models/batch - Enable, disable or upsert many models of one provider
ModelRoutes.post(
  '/batch',
  routeDoc({
    data: BatchModelsResultSchema,
    description:
      '`enable` / `disable` flip the listed models (built-in models get a row on first write); `upsert` creates or updates full model entries, e.g. a list fetched from `GET /providers/{id}/remote-models` stored with `source: "remote"`. At most 500 models per call. 404 when the provider is not one of the built-in providers and not configured in the caller\'s scope.',
    errors: [404],
    operationId: 'models.batch',
    requestExample: BATCH_MODELS_REQUEST_EXAMPLE,
    summary: 'Batch enable, disable or upsert models',
    tags: ['models'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_MODEL_UPDATE'),
    'You do not have permission to update models',
  ),
  zValidator('json', BatchModelsRequestSchema),
  (c) => new AiInfraOpsController().batchModels(c),
);

// PUT /api/v1/models/order - Set the display order of a provider's models
ModelRoutes.put(
  '/order',
  routeDoc({
    data: ReorderModelsResultSchema,
    description:
      "Writes each listed model's `sort`; listed models that have no row yet are stored enabled. 404 when the provider is not addressable.",
    errors: [404],
    operationId: 'models.reorder',
    requestExample: REORDER_MODELS_REQUEST_EXAMPLE,
    summary: "Reorder a provider's models",
    tags: ['models'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_MODEL_UPDATE'),
    'You do not have permission to reorder models',
  ),
  zValidator('json', ReorderModelsRequestSchema),
  (c) => new AiInfraOpsController().reorderModels(c),
);

// DELETE /api/v1/models/:providerId/:modelId - Delete a model
ModelRoutes.delete(
  '/:providerId/:modelId',
  routeDoc({
    data: DeletedResourceSchema,
    description:
      'Removes the stored model row (a custom or remote model, or the saved overrides of a built-in one). In a workspace this needs the admin role. `id` is the model id.',
    errors: [404],
    operationId: 'models.delete',
    summary: 'Delete a model',
    tags: ['models'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_MODEL_DELETE'),
    'You do not have permission to delete a model',
  ),
  // Model deletes are workspace-wide, so like the settings UI they are admin-only.
  requireWorkspaceRoleWhenScoped('admin'),
  zValidator('param', ModelIdParamSchema),
  (c) => new AiInfraOpsController().deleteModel(c),
);

// The reasoning default is the caller's own preference (keyed by user, shared
// across workspaces), so like the tRPC procedure it is not gated by the shared
// model-management permission: any member who can read models may save it.
// A restricted key still needs `model:write` to change it.

// GET /api/v1/models/:providerId/:modelId/reasoning-config
ModelRoutes.get(
  '/:providerId/:modelId/reasoning-config',
  routeDoc({
    data: ModelReasoningConfigResultSchema,
    description:
      "The caller's own default reasoning parameters for this model, shared across workspaces. `config` is `{}` when none is saved.",
    errors: [404],
    operationId: 'models.getReasoningConfig',
    summary: 'Get your reasoning defaults for a model',
    tags: ['models'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_MODEL_READ'),
    'You do not have permission to view model settings',
  ),
  zValidator('param', ModelIdParamSchema),
  (c) => new AiInfraOpsController().getReasoningConfig(c),
);

// PUT /api/v1/models/:providerId/:modelId/reasoning-config
ModelRoutes.put(
  '/:providerId/:modelId/reasoning-config',
  routeDoc({
    data: ModelReasoningConfigResultSchema,
    description:
      'Merges the given fields into your saved defaults for this model (fields you omit keep their value) and returns the result. Does not change whether the model is enabled.',
    errors: [404],
    operationId: 'models.updateReasoningConfig',
    requestExample: REASONING_CONFIG_REQUEST_EXAMPLE,
    summary: 'Update your reasoning defaults for a model',
    tags: ['models'],
  }),
  requireAuth,
  requireAnyPermissionWithApiKeyScope(
    getAllScopePermissions('AI_MODEL_READ'),
    'model:write',
    'You do not have permission to change model settings',
  ),
  zValidator('param', ModelIdParamSchema),
  zValidator('json', ModelReasoningConfigSchema),
  (c) => new AiInfraOpsController().updateReasoningConfig(c),
);

export default ModelRoutes;
