import { Hono } from 'hono';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { OAuthAppController } from '../controllers/oauth-app.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import { requireWorkspaceRoleWhenScoped } from '../middleware/workspace';
import { DeletedResourceSchema } from '../types/common.type';
import {
  CreatedOAuthAppSchema,
  CreateOAuthAppRequestSchema,
  OAuthAppIdParamSchema,
  OAuthAppListQuerySchema,
  OAuthAppListSchema,
  OAuthAppSchema,
  OAuthAppSecretSchema,
  UpdateOAuthAppRequestSchema,
} from '../types/oauth-app.type';

/**
 * OAuth applications — clients that sign users in with LobeHub (device flow
 * for CLIs, authorization code for web apps). Without `X-Workspace-Id` these
 * are the caller's personal apps; with it, the workspace's apps, which every
 * member may read and only owners and admins may change (the same rule as the
 * in-app settings page).
 */
const OAuthAppsRoutes = new Hono();

const read = requireApiKeyScope('oauth_app:read');
const write = requireApiKeyScope('oauth_app:write');
const workspaceAdmin = requireWorkspaceRoleWhenScoped('admin');

const WRITE_NOTE =
  'Inside a workspace this needs the owner or admin role; other members receive 403.';

/** GET /api/v1/oauth-apps */
OAuthAppsRoutes.get(
  '/',
  routeDoc({
    data: OAuthAppListSchema,
    description:
      'Newest first. Client secrets are never returned; `hasSecret` tells whether one exists.',
    operationId: 'oauthApps.list',
    summary: 'List OAuth apps',
    tags: ['oauth-apps'],
  }),
  requireAuth,
  read,
  zValidator('query', OAuthAppListQuerySchema),
  async (c) => new OAuthAppController().listApps(c),
);

/** POST /api/v1/oauth-apps */
OAuthAppsRoutes.post(
  '/',
  routeDoc({
    data: CreatedOAuthAppSchema,
    description: `A \`web\` app gets its client secret in this response only (unless \`issueSecret\` is \`false\`); store it now. A \`device\` app is a public client with no secret. ${WRITE_NOTE}`,
    operationId: 'oauthApps.create',
    status: 201,
    summary: 'Create an OAuth app',
    tags: ['oauth-apps'],
  }),
  requireAuth,
  write,
  workspaceAdmin,
  zValidator('json', CreateOAuthAppRequestSchema),
  async (c) => new OAuthAppController().create(c),
);

/** GET /api/v1/oauth-apps/:id */
OAuthAppsRoutes.get(
  '/:id',
  routeDoc({
    data: OAuthAppSchema,
    errors: [404],
    operationId: 'oauthApps.get',
    summary: 'Get an OAuth app',
    tags: ['oauth-apps'],
  }),
  requireAuth,
  read,
  zValidator('param', OAuthAppIdParamSchema),
  async (c) => new OAuthAppController().get(c),
);

/** PATCH /api/v1/oauth-apps/:id */
OAuthAppsRoutes.patch(
  '/:id',
  routeDoc({
    data: OAuthAppSchema,
    description: `Edits the app, and enables or disables it with \`enabled\`. A disabled app cannot sign anyone in and its tokens cannot be refreshed. ${WRITE_NOTE}`,
    errors: [404],
    operationId: 'oauthApps.update',
    summary: 'Update an OAuth app',
    tags: ['oauth-apps'],
  }),
  requireAuth,
  write,
  workspaceAdmin,
  zValidator('param', OAuthAppIdParamSchema),
  zValidator('json', UpdateOAuthAppRequestSchema),
  async (c) => new OAuthAppController().update(c),
);

/** DELETE /api/v1/oauth-apps/:id */
OAuthAppsRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    description: `Deletes the app with its grants and tokens; it cannot be undone. ${WRITE_NOTE}`,
    errors: [404],
    operationId: 'oauthApps.delete',
    summary: 'Delete an OAuth app',
    tags: ['oauth-apps'],
  }),
  requireAuth,
  write,
  workspaceAdmin,
  zValidator('param', OAuthAppIdParamSchema),
  async (c) => new OAuthAppController().delete(c),
);

/** POST /api/v1/oauth-apps/:id/rotate-secret */
OAuthAppsRoutes.post(
  '/:id/rotate-secret',
  routeDoc({
    data: OAuthAppSecretSchema,
    description: `Issues a web app's first client secret, or replaces it — the previous secret stops working immediately. The plaintext is returned once. A device app has no secret (409). ${WRITE_NOTE}`,
    errors: [404, 409],
    operationId: 'oauthApps.rotateSecret',
    summary: "Rotate an OAuth app's client secret",
    tags: ['oauth-apps'],
  }),
  requireAuth,
  write,
  workspaceAdmin,
  zValidator('param', OAuthAppIdParamSchema),
  async (c) => new OAuthAppController().rotateSecret(c),
);

export default OAuthAppsRoutes;
