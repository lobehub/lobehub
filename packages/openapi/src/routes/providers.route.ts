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
  requireAnyPermission(getAllScopePermissions('AI_PROVIDER_READ'), '您没有权限查看 Provider 列表'),
  zValidator('query', ProviderListQuerySchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleGetProviders(c);
  },
);

ProviderRoutes.get(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AI_PROVIDER_READ'), '您没有权限查看 Provider 详情'),
  zValidator('param', ProviderIdParamSchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleGetProvider(c);
  },
);

ProviderRoutes.post(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AI_PROVIDER_CREATE'), '您没有权限创建 Provider'),
  zValidator('json', CreateProviderRequestSchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleCreateProvider(c);
  },
);

ProviderRoutes.patch(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AI_PROVIDER_UPDATE'), '您没有权限更新 Provider'),
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
  requireAnyPermission(getAllScopePermissions('AI_PROVIDER_DELETE'), '您没有权限删除 Provider'),
  zValidator('param', ProviderIdParamSchema),
  (c) => {
    const controller = new ProviderController();
    return controller.handleDeleteProvider(c);
  },
);

export default ProviderRoutes;
