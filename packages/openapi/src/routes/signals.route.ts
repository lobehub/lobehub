import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { AgentSignalController } from '../controllers/agent-signal.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  EmitSourceEventRequestSchema,
  ListReceiptsQuerySchema,
  TriggerSourceEventRequestSchema,
} from '../types/agent-signal.type';

/**
 * Agent Signal routes.
 *
 * Emitting is the "wake the agent" path, so it carries the same
 * `message:create` gate the in-app producers use; receipts are auth-only and
 * scoped to the caller inside the service.
 */
const AgentSignalRoutes = new Hono();

const signalWrite = requireAnyPermission(
  getAllScopePermissions('MESSAGE_CREATE'),
  'You do not have permission to emit agent signals',
);

/** POST /api/v1/signals/source-events — emit a client-side event. */
AgentSignalRoutes.post(
  '/source-events',
  describeRoute({ operationId: 'emitSourceEvent', tags: ['signals'] }),
  requireAuth,
  signalWrite,
  zValidator('json', EmitSourceEventRequestSchema),
  async (c) => new AgentSignalController().emitSourceEvent(c),
);

/** POST /api/v1/signals/trigger — synthesise and enqueue a trigger event. */
AgentSignalRoutes.post(
  '/trigger',
  describeRoute({ operationId: 'triggerSourceEvent', tags: ['signals'] }),
  requireAuth,
  signalWrite,
  zValidator('json', TriggerSourceEventRequestSchema),
  async (c) => new AgentSignalController().triggerSourceEvent(c),
);

/** GET /api/v1/signals/receipts — processed-event receipts for a topic. */
AgentSignalRoutes.get(
  '/receipts',
  describeRoute({ operationId: 'listSignalReceipts', tags: ['signals'] }),
  requireAuth,
  zValidator('query', ListReceiptsQuerySchema),
  async (c) => new AgentSignalController().listReceipts(c),
);

export default AgentSignalRoutes;
