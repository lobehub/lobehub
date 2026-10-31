import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { z } from 'zod';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { ConnectorController } from '../controllers/connector.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';
import {
  ConnectorAgentScopeSchema,
  ConnectorAuthorizeSchema,
  ConnectorDisconnectResponseSchema,
  ConnectorDisconnectSchema,
  ConnectorIdSchema,
  ConnectorProviderSchema,
  ConnectorResponseSchema,
  ConnectorSessionIdSchema,
  connectorSuccess,
} from '../types/connector.type';

export const ConnectorsRoutes = new Hono();
const read = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AGENT_READ'),
  'agent:read',
);
const write = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('AGENT_UPDATE'),
  'agent:write',
);
const response = (summary: string, schema: z.ZodType) =>
  describeRoute({
    summary,
    tags: ['connectors'],
    responses: {
      200: {
        description: 'Connector operation result',
        content: { 'application/json': { schema: resolver(connectorSuccess(schema)) } },
      },
    },
  });

ConnectorsRoutes.get(
  '/catalog',
  response('List supported personal services', z.array(ConnectorProviderSchema)),
  requireAuth,
  read,
  (c) => new ConnectorController().execute(c, 'catalog'),
);
ConnectorsRoutes.get(
  '/',
  response('List personal service connections', z.array(ConnectorResponseSchema)),
  requireAuth,
  read,
  (c) => new ConnectorController().execute(c, 'list'),
);
ConnectorsRoutes.post(
  '/authorizations',
  response('Start or resume a service authorization', ConnectorResponseSchema),
  requireAuth,
  write,
  zValidator('json', ConnectorAuthorizeSchema),
  (c) => new ConnectorController().execute(c, 'authorize'),
);
ConnectorsRoutes.get(
  '/authorizations/:sessionId',
  response('Reconcile authorization and tool readiness', ConnectorResponseSchema),
  requireAuth,
  write,
  zValidator('param', ConnectorSessionIdSchema),
  (c) => new ConnectorController().execute(c, 'reconcile'),
);
ConnectorsRoutes.post(
  '/authorizations/:sessionId/cancel',
  response('Reconcile system cancellation', ConnectorResponseSchema),
  requireAuth,
  write,
  zValidator('param', ConnectorSessionIdSchema),
  (c) => new ConnectorController().execute(c, 'cancel'),
);
ConnectorsRoutes.get(
  '/:id',
  response('Get a personal service connection', ConnectorResponseSchema),
  requireAuth,
  read,
  zValidator('param', ConnectorIdSchema),
  (c) => new ConnectorController().execute(c, 'get'),
);
ConnectorsRoutes.post(
  '/:id/refresh',
  response('Refresh connection permissions and tools', ConnectorResponseSchema),
  requireAuth,
  write,
  zValidator('param', ConnectorIdSchema),
  (c) => new ConnectorController().execute(c, 'refresh'),
);
ConnectorsRoutes.put(
  '/:id/agents',
  response('Confirm agents allowed to use this connection', ConnectorResponseSchema),
  requireAuth,
  write,
  zValidator('param', ConnectorIdSchema),
  zValidator('json', ConnectorAgentScopeSchema),
  (c) => new ConnectorController().execute(c, 'agents'),
);
ConnectorsRoutes.post(
  '/:id/disconnect',
  response(
    'Stop local access and revoke the provider connection',
    ConnectorDisconnectResponseSchema,
  ),
  requireAuth,
  write,
  zValidator('param', ConnectorIdSchema),
  zValidator('json', ConnectorDisconnectSchema),
  (c) => new ConnectorController().execute(c, 'disconnect'),
);
