import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { AgentSignalController } from '../controllers/agent-signal.controller';
import { requireAuth } from '../middleware/auth';
import {
  requireAnyPermissionWithApiKeyScope,
  requireApiKeyScope,
} from '../middleware/permission-check';
import {
  EmitSourceEventRequestSchema,
  ListReceiptsQuerySchema,
  TriggerSourceEventRequestSchema,
} from '../types/agent-signal.type';

/**
 * Agent Signal routes.
 *
 * Emitting is the "wake the agent" path, so it carries the RBAC gate the in-app
 * producer uses (`message:create`) *and* the delegated-key scopes the catalog
 * assigns to `agentSignal`: `agent:write` for the namespace, plus
 * `model:invoke` because both emissions enqueue workflows whose judges call a
 * model. Without them a `chat:write`-only key could spend model budget, which
 * the tRPC contract (`agentSignal.*` + `TRPC_PROCEDURE_EXTRA_SCOPES`) forbids.
 * Receipts are a read of the caller's own events, so they take `agent:read`.
 */
const AgentSignalRoutes = new Hono();

const signalWrite = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('MESSAGE_CREATE'),
  'agent:write',
  'You do not have permission to emit agent signals',
);

/** Enqueueing a signal can start model-backed analysis, so it needs `model:invoke`. */
const signalRun = requireApiKeyScope('model:invoke');

/** Reading your own receipts is the namespace's read capability. */
const signalRead = requireApiKeyScope('agent:read');

/** POST /api/v1/signals/source-events — emit a client-side event. */
AgentSignalRoutes.post(
  '/source-events',
  describeRoute({ operationId: 'emitSourceEvent', tags: ['signals'] }),
  requireAuth,
  signalWrite,
  signalRun,
  zValidator('json', EmitSourceEventRequestSchema),
  async (c) => new AgentSignalController().emitSourceEvent(c),
);

/** POST /api/v1/signals/trigger — synthesise and enqueue a trigger event. */
AgentSignalRoutes.post(
  '/trigger',
  describeRoute({ operationId: 'triggerSourceEvent', tags: ['signals'] }),
  requireAuth,
  signalWrite,
  signalRun,
  zValidator('json', TriggerSourceEventRequestSchema),
  async (c) => new AgentSignalController().triggerSourceEvent(c),
);

/** GET /api/v1/signals/receipts — processed-event receipts for a topic. */
AgentSignalRoutes.get(
  '/receipts',
  describeRoute({ operationId: 'listSignalReceipts', tags: ['signals'] }),
  requireAuth,
  signalRead,
  zValidator('query', ListReceiptsQuerySchema),
  async (c) => new AgentSignalController().listReceipts(c),
);

export default AgentSignalRoutes;
