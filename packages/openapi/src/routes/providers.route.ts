import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { ProviderController } from '../controllers/provider.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  CreateProviderRequestSchema,
  ProviderIdParamSchema,
  ProviderListQuerySchema,
  UpdateProviderRequestSchema,
} from '../types/provider.type';

const ProviderRoutes = new Hono();

ProviderRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AI_PROVIDER_READ'), 'You do not have permission to view provider list'),
  zValidator('query', ProviderListQuerySchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleGetProviders(c);
  },
);

ProviderRoutes.get(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AI_PROVIDER_READ'), 'You do not have permission to view provider details'),
  zValidator('param', ProviderIdParamSchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleGetProvider(c);
  },
);

ProviderRoutes.post(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AI_PROVIDER_CREATE'), 'You do not have permission to create a provider'),
  zValidator('json', CreateProviderRequestSchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleCreateProvider(c);
  },
);

ProviderRoutes.patch(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AI_PROVIDER_UPDATE'), 'You do not have permission to update a provider'),
  zValidator('param', ProviderIdParamSchema),
  zValidator('json', UpdateProviderRequestSchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleUpdateProvider(c);
  },
);

ProviderRoutes.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AI_PROVIDER_DELETE'), 'You do not have permission to delete a provider'),
  zValidator('param', ProviderIdParamSchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleDeleteProvider(c);
  },
);

export default ProviderRoutes;
