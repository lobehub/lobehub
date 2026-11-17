import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { AiInfraOpsController } from '../controllers/ai-infra-ops.controller';
import { ProviderController } from '../controllers/provider.controller';
import { requireAuth } from '../middleware/auth';
import {
  requireAnyPermission,
  requireAnyPermissionWithApiKeyScope,
  requireApiKeyScope,
} from '../middleware/permission-check';
import { requireWorkspaceRoleWhenScoped } from '../middleware/workspace';
import { DeletedResourceSchema } from '../types/common.type';
import {
  CreateProviderRequestSchema,
  ProviderIdParamSchema,
  ProviderListQuerySchema,
  ProviderListSchema,
  ProviderSchema,
  UpdateProviderRequestSchema,
} from '../types/provider.type';
import {
  CHECK_PROVIDER_REQUEST_EXAMPLE,
  CheckProviderRequestSchema,
  ProviderCheckResultSchema,
  ProviderConfigResultSchema,
  RemoteModelListSchema,
  REORDER_PROVIDERS_REQUEST_EXAMPLE,
  ReorderProvidersRequestSchema,
  ReorderProvidersResultSchema,
  UPDATE_PROVIDER_CONFIG_REQUEST_EXAMPLE,
  UpdateProviderConfigRequestSchema,
} from '../types/provider-ops.type';

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

const NOT_ADDRESSABLE =
  "404 when the id is neither a built-in provider nor a provider configured in the caller's scope (personal, or the `X-Workspace-Id` workspace).";

// PUT /api/v1/providers/order - Set the display order of providers
ProviderRoutes.put(
  '/order',
  routeDoc({
    data: ReorderProvidersResultSchema,
    description: `Writes each listed provider's \`sort\`; a built-in provider with no row yet is stored enabled. ${NOT_ADDRESSABLE}`,
    errors: [404],
    operationId: 'providers.reorder',
    requestExample: REORDER_PROVIDERS_REQUEST_EXAMPLE,
    summary: 'Reorder providers',
    tags: ['providers'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_PROVIDER_UPDATE'),
    'You do not have permission to reorder providers',
  ),
  zValidator('json', ReorderProvidersRequestSchema),
  (c) => new AiInfraOpsController().reorderProviders(c),
);

// POST /api/v1/providers/:id/check - Probe the provider with the stored credentials
ProviderRoutes.post(
  '/:id/check',
  routeDoc({
    data: ProviderCheckResultSchema,
    description: `Sends a one-message probe to \`model\` (or the provider's check model) with the stored credentials; providers that support it verify the key without a chat call. A failed probe is still a 200 with \`ok: false\` and the provider's reason. The probe is billed by the provider, so a restricted key also needs \`model:invoke\`. ${NOT_ADDRESSABLE}`,
    errors: [404],
    operationId: 'providers.check',
    requestExample: CHECK_PROVIDER_REQUEST_EXAMPLE,
    summary: 'Check provider connectivity',
    tags: ['providers'],
  }),
  requireAuth,
  requireAnyPermissionWithApiKeyScope(
    getAllScopePermissions('AI_PROVIDER_UPDATE'),
    'model:read',
    'You do not have permission to check a provider',
  ),
  requireApiKeyScope('model:invoke'),
  zValidator('param', ProviderIdParamSchema),
  zValidator('json', CheckProviderRequestSchema),
  (c) => new AiInfraOpsController().checkProvider(c),
);

// GET /api/v1/providers/:id/remote-models - The provider's own model list
ProviderRoutes.get(
  '/:id/remote-models',
  routeDoc({
    data: RemoteModelListSchema,
    description: `Asks the provider for its model list with the stored credentials, without saving anything. To keep the list, send it to \`POST /models/batch\` with \`action: "upsert"\` and \`source: "remote"\`. A provider that only the user's own device can reach (e.g. a local Ollama) has no browser to relay through and answers an error. Provider failures map to their HTTP status (401 bad key, 429 quota, otherwise 502). ${NOT_ADDRESSABLE}`,
    errors: [404, 502],
    operationId: 'providers.listRemoteModels',
    summary: "List the provider's remote models",
    tags: ['providers'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_PROVIDER_READ'),
    'You do not have permission to view provider models',
  ),
  zValidator('param', ProviderIdParamSchema),
  (c) => new AiInfraOpsController().listRemoteModels(c),
);

// PATCH /api/v1/providers/:id/config - Credentials and connection settings
ProviderRoutes.patch(
  '/:id/config',
  routeDoc({
    data: ProviderConfigResultSchema,
    description: `Writes the provider's credentials and connection settings, creating the row for a built-in provider on first write. \`keyVaults\` is merged into the encrypted vault; the response reports only which credential fields are stored, never their values. In a workspace this needs the admin role. ${NOT_ADDRESSABLE}`,
    errors: [404],
    operationId: 'providers.updateConfig',
    requestExample: UPDATE_PROVIDER_CONFIG_REQUEST_EXAMPLE,
    summary: "Update a provider's credentials and connection config",
    tags: ['providers'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AI_PROVIDER_UPDATE'),
    'You do not have permission to update a provider',
  ),
  // Provider credentials are workspace-shared, so config writes are admin-only.
  requireWorkspaceRoleWhenScoped('admin'),
  zValidator('param', ProviderIdParamSchema),
  zValidator('json', UpdateProviderConfigRequestSchema),
  (c) => new AiInfraOpsController().updateProviderConfig(c),
);

export default ProviderRoutes;
