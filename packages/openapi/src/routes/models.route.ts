import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { ModelController } from '../controllers';
import { requireAuth } from '../middleware';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  CreateModelRequestSchema,
  ModelIdParamSchema,
  ModelsListQuerySchema,
  UpdateModelRequestSchema,
} from '../types/model.type';

// Models-related routes
const ModelRoutes = new Hono();

// GET /api/v1/models - Get model list (supports pagination, filtering, and grouping)
ModelRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AI_MODEL_READ'), 'You do not have permission to view model list'),
  zValidator('query', ModelsListQuerySchema),
  (c) => {
    const controller = new ModelController();
    return controller.handleGetModels(c);
  },
);

// POST /api/v1/models - Create a model
ModelRoutes.post(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AI_MODEL_CREATE'), 'You do not have permission to create a model'),
  zValidator('json', CreateModelRequestSchema),
  (c) => {
    const controller = new ModelController();
    return controller.handleCreateModel(c);
  },
);

// GET /api/v1/models/:providerId/:modelId - Get model details
ModelRoutes.get(
  '/:providerId/:modelId',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AI_MODEL_READ'), 'You do not have permission to view model details'),
  zValidator('param', ModelIdParamSchema),
  (c) => {
    const controller = new ModelController();
    return controller.handleGetModel(c);
  },
);

// PATCH /api/v1/models/:providerId/:modelId - Update a model
ModelRoutes.patch(
  '/:providerId/:modelId',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AI_MODEL_UPDATE'), 'You do not have permission to update a model'),
  zValidator('param', ModelIdParamSchema),
  zValidator('json', UpdateModelRequestSchema),
  (c) => {
    const controller = new ModelController();
    return controller.handleUpdateModel(c);
  },
);

export default ModelRoutes;
