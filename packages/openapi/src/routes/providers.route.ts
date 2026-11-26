import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ProviderController } from '../controllers/provider.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  CreateProviderRequestSchema,
  ProviderIdParamSchema,
  ProviderListQuerySchema,
  ProviderListSchema,
  ProviderSchema,
  UpdateProviderRequestSchema,
} from '../types/provider.type';

const ProviderRoutes = new Hono();

ProviderRoutes.get(
  '/',
  routeDoc({ data: ProviderListSchema, summary: 'List providers', tags: ['providers'] }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_PROVIDER_READ'),
    'You do not have permission to view provider list',
  ),
  zValidator('query', ProviderListQuerySchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleGetProviders(c);
  },
);

ProviderRoutes.get(
  '/:id',
  routeDoc({ data: ProviderSchema, errors: [404], summary: 'Get a provider', tags: ['providers'] }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_PROVIDER_READ'),
    'You do not have permission to view provider details',
  ),
  zValidator('param', ProviderIdParamSchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleGetProvider(c);
  },
);

ProviderRoutes.post(
  '/',
  routeDoc({ data: ProviderSchema, summary: 'Create a provider', tags: ['providers'] }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_PROVIDER_CREATE'),
    'You do not have permission to create a provider',
  ),
  zValidator('json', CreateProviderRequestSchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleCreateProvider(c);
  },
);

ProviderRoutes.patch(
  '/:id',
  routeDoc({
    data: ProviderSchema,
    errors: [404],
    summary: 'Update a provider',
    tags: ['providers'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_PROVIDER_UPDATE'),
    'You do not have permission to update a provider',
  ),
  zValidator('param', ProviderIdParamSchema),
  zValidator('json', UpdateProviderRequestSchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleUpdateProvider(c);
  },
);

ProviderRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    description: 'Also removes the models configured under the provider.',
    errors: [404],
    summary: 'Delete a provider',
    tags: ['providers'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_PROVIDER_DELETE'),
    'You do not have permission to delete a provider',
  ),
  zValidator('param', ProviderIdParamSchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleDeleteProvider(c);
  },
);

export default ProviderRoutes;
