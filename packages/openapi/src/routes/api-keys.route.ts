import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ApiKeyController } from '../controllers/api-key.controller';
import {
  LEGACY_ARRAY_LIST_DESCRIPTION,
  LegacyArrayListQuerySchema,
} from '../helpers/legacy-array-list';
import { paginatedListSchema } from '../helpers/pagination';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import { requireWorkspaceRoleWhenScoped } from '../middleware/workspace';
import {
  ApiKeyIdParamSchema,
  ApiKeySchema,
  CreateApiKeyRequestSchema,
  CreatedApiKeySchema,
  UpdateApiKeyRequestSchema,
} from '../types/api-key.type';
import { DeletedResourceSchema } from '../types/common.type';

const app = new Hono();

// API keys are credentials and `ApiKeyModel`'s predicate is workspace-wide, so
// every route here is admin-gated when workspace-scoped — matching the tRPC
// `apiKeyProcedure`, which applies `requireWorkspaceRoleWhenScoped('admin')` to
// the whole router.
const requireWorkspaceAdmin = requireWorkspaceRoleWhenScoped('admin');

app.get(
  '/',
  routeDoc({
    data: paginatedListSchema(ApiKeySchema, { total: true }),
    description: LEGACY_ARRAY_LIST_DESCRIPTION,
    summary: 'List API keys',
    tags: ['api-keys'],
  }),
  requireAuth,
  requireWorkspaceAdmin,
  requireAnyPermission(getAllScopePermissions('API_KEY_READ')),
  zValidator('query', LegacyArrayListQuerySchema),
  async (c) => new ApiKeyController().getApiKeys(c),
);

app.post(
  '/',
  routeDoc({
    data: CreatedApiKeySchema,
    description: 'The plaintext key is returned only in this response.',
    status: 201,
    summary: 'Create an API key',
    tags: ['api-keys'],
  }),
  requireAuth,
  requireWorkspaceAdmin,
  requireAnyPermission(getAllScopePermissions('API_KEY_CREATE')),
  zValidator('json', CreateApiKeyRequestSchema),
  async (c) => new ApiKeyController().createApiKey(c),
);

app.get(
  '/:id',
  routeDoc({ data: ApiKeySchema, errors: [404], summary: 'Get an API key', tags: ['api-keys'] }),
  requireAuth,
  requireWorkspaceAdmin,
  requireAnyPermission(getAllScopePermissions('API_KEY_READ')),
  zValidator('param', ApiKeyIdParamSchema),
  async (c) => new ApiKeyController().getApiKey(c),
);

app.patch(
  '/:id',
  routeDoc({
    data: ApiKeySchema,
    errors: [404],
    summary: 'Update an API key',
    tags: ['api-keys'],
  }),
  requireAuth,
  requireWorkspaceAdmin,
  requireAnyPermission(getAllScopePermissions('API_KEY_UPDATE')),
  zValidator('param', ApiKeyIdParamSchema),
  zValidator('json', UpdateApiKeyRequestSchema),
  async (c) => new ApiKeyController().updateApiKey(c),
);

app.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    summary: 'Delete an API key',
    tags: ['api-keys'],
  }),
  requireAuth,
  requireWorkspaceAdmin,
  requireAnyPermission(getAllScopePermissions('API_KEY_DELETE')),
  zValidator('param', ApiKeyIdParamSchema),
  async (c) => new ApiKeyController().deleteApiKey(c),
);

export default app;
