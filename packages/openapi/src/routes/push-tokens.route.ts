import { Hono } from 'hono';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ImController } from '../controllers/im.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  LiveActivityRegisterRequestSchema,
  LiveActivityRegistrationSchema,
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

/** PUT /api/v1/push-tokens/:deviceId/live-activities */
PushTokenRoutes.put(
  '/:deviceId/live-activities',
  routeDoc({
    data: LiveActivityRegistrationSchema,
    description:
      "Registers or rotates the ActivityKit update token of an iOS Live Activity that shows a run's pending intervention (approval / question), keyed by `activityKey`. The device must already be registered with `PUT /push-tokens/{deviceId}`, and the run must be visible to the caller; otherwise 404. A workspace credential may register for a workspace run. The answer carries the intervention's current state so a late registration can end its activity at once.",
    errors: [404],
    operationId: 'pushTokens.registerLiveActivity',
    summary: 'Register a Live Activity push token',
    tags: ['push-tokens'],
  }),
  requireAuth,
  pushScope,
  zValidator('param', PushTokenParamSchema),
  zValidator('json', LiveActivityRegisterRequestSchema),
  async (c) => new ImController().registerLiveActivity(c),
);

export default PushTokenRoutes;
