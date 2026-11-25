import { Hono } from 'hono';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ImController } from '../controllers/im.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  PushTokenParamSchema,
  PushTokenRegisterRequestSchema,
  PushTokenRegistrationSchema,
  PushTokenUnregisterQuerySchema,
} from '../types/im.type';

/**
 * Push-token routes — the REST twin of the mobile `pushToken` tRPC router, so a
 * client that talks to LobeHub only through the SDK can receive the completion
 * push of its conversations. One row per (user, device); re-registering a
 * device rotates its token.
 */
const PushTokenRoutes = new Hono();

/**
 * A registered device receives the completion push of the user's
 * conversations, i.e. chat content — a restricted key needs `chat:read`.
 */
const pushScope = requireApiKeyScope('chat:read');

/** PUT /api/v1/push-tokens/:deviceId */
PushTokenRoutes.put(
  '/:deviceId',
  routeDoc({
    data: PushTokenRegistrationSchema,
    operationId: 'pushTokens.register',
    summary: "Register or rotate this device's push token",
    tags: ['push-tokens'],
  }),
  requireAuth,
  pushScope,
  zValidator('param', PushTokenParamSchema),
  zValidator('json', PushTokenRegisterRequestSchema),
  async (c) => new ImController().registerPushToken(c),
);

/** DELETE /api/v1/push-tokens/:deviceId */
PushTokenRoutes.delete(
  '/:deviceId',
  routeDoc({
    data: DeletedResourceSchema,
    description:
      '`id` is the device id. Idempotent: a stale `expoToken` removes nothing and leaves the rotated registration in place.',
    operationId: 'pushTokens.unregister',
    summary: 'Stop pushing to this device (sign-out)',
    tags: ['push-tokens'],
  }),
  requireAuth,
  pushScope,
  zValidator('param', PushTokenParamSchema),
  zValidator('query', PushTokenUnregisterQuerySchema),
  async (c) => new ImController().unregisterPushToken(c),
);

export default PushTokenRoutes;
