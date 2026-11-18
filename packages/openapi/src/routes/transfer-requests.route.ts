import { API_KEY_FULL_ACCESS_SCOPE } from '@lobechat/const';
import { Hono } from 'hono';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { TransferRequestController } from '../controllers/transfer-request.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import {
  CreateTransferRequestSchema,
  TransferRequestIdParamSchema,
  TransferRequestListQuerySchema,
  TransferRequestListResponseSchema,
  TransferRequestOutcomeSchema,
  TransferRequestSchema,
} from '../types/transfer-request.type';

/**
 * Transfer request routes: hand an agent or agent group to another member of
 * the same team workspace, and answer such requests.
 *
 * Requests exist only inside a workspace — send `X-Workspace-Id` (or use a
 * workspace-bound key). Only the two parties ever see a request; anyone else
 * gets 404 for its id.
 *
 * API key scopes: a full-access key for every route. A handover is an
 * ownership decision between two people that a restricted key never takes
 * part in — the tRPC surface blocks `resourceTransferRequest` for restricted
 * keys the same way.
 */
const TransferRequestRoutes = new Hono();

const decide = requireApiKeyScope(API_KEY_FULL_ACCESS_SCOPE);
const tags = ['transfer-requests'];

/** GET /api/v1/transfer-requests */
TransferRequestRoutes.get(
  '/',
  routeDoc({
    data: TransferRequestListResponseSchema,
    description:
      'Pending requests in the workspace where the caller is the recipient (to answer) or the initiator (to track or withdraw).',
    summary: 'List my transfer requests',
    tags,
  }),
  requireAuth,
  decide,
  zValidator('query', TransferRequestListQuerySchema),
  async (c) => new TransferRequestController().listTransferRequests(c),
);

/** POST /api/v1/transfer-requests */
TransferRequestRoutes.post(
  '/',
  routeDoc({
    data: TransferRequestSchema,
    description:
      'Asks another workspace member to take over an agent or agent group. Ownership moves only when they accept; 409 when the resource already has a pending request.',
    errors: [404, 409],
    requestExample: example(CreateTransferRequestSchema, {
      recipientId: 'user_teammate',
      resourceId: 'agt_abc123',
      resourceType: 'agent',
    }),
    status: 201,
    summary: 'Request a transfer',
    tags,
  }),
  requireAuth,
  decide,
  zValidator('json', CreateTransferRequestSchema),
  async (c) => new TransferRequestController().createTransferRequest(c),
);

const RESOLUTIONS = [
  {
    action: 'accept',
    description:
      'Recipient accepts: ownership is handed over in one transaction. 404 when the caller is not the recipient; 412 when the agent still has a share link.',
    summary: 'Accept a transfer request',
  },
  {
    action: 'decline',
    description:
      'Recipient declines; ownership stays where it is. 404 when the request does not exist or is not addressed to the caller; 409 when it is no longer pending.',
    summary: 'Decline a transfer request',
  },
  {
    action: 'cancel',
    description:
      'Initiator withdraws a pending request. 404 when the request does not exist or was not started by the caller; 409 when it is no longer pending.',
    summary: 'Cancel a transfer request',
  },
] as const;

for (const { action, description, summary } of RESOLUTIONS) {
  /** POST /api/v1/transfer-requests/:id/{accept|decline|cancel} */
  TransferRequestRoutes.post(
    `/:id/${action}`,
    routeDoc({
      data: TransferRequestOutcomeSchema,
      description,
      errors: [404, 409, 412],
      operationId: `transferRequests.${action}`,
      summary,
      tags,
    }),
    requireAuth,
    decide,
    zValidator('param', TransferRequestIdParamSchema),
    async (c) => new TransferRequestController().resolve(action)(c),
  );
}

export default TransferRequestRoutes;
