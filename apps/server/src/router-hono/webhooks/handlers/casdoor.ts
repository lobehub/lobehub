import type { Context } from 'hono';

import { serverDB } from '@/database/server';
import { authEnv } from '@/envs/auth';
import { WebhookUserService } from '@/server/services/webhookUser';

import { validateRequest } from './casdoorValidateRequest';

export const casdoorWebhook = async (c: Context): Promise<Response> => {
  const payload = await validateRequest(c.req.raw, authEnv.CASDOOR_WEBHOOK_SECRET);

  if (!payload) {
    return c.json({ error: 'webhook verification failed or payload was malformed' }, 400);
  }

  const { action, object } = payload;

  const webhookUserService = new WebhookUserService(serverDB);
  switch (action) {
    case 'update-user': {
      return webhookUserService.safeUpdateUser(
        {
          accountId: object.id,
          providerId: 'casdoor',
        },
        {
          avatar: object?.avatar,
          email: object?.email,
          fullName: object.displayName,
        },
      );
    }

    default: {
      console.warn(
        `${c.req.url} received event type "${action}", but no handler is defined for this type`,
      );
      return c.json({ error: `unrecognised payload type: ${action}` }, 400);
    }
  }
};
