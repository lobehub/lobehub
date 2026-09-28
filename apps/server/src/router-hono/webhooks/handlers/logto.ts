import type { Context } from 'hono';

import { serverDB } from '@/database/server';
import { authEnv } from '@/envs/auth';
import { WebhookUserService } from '@/server/services/webhookUser';

import { validateRequest } from './logtoValidateRequest';

export const logtoWebhook = async (c: Context): Promise<Response> => {
  const payload = await validateRequest(c.req.raw, authEnv.LOGTO_WEBHOOK_SIGNING_KEY!);

  if (!payload) {
    return c.json({ error: 'webhook verification failed or payload was malformed' }, 400);
  }

  const { event, data } = payload;

  console.info(`logto webhook payload: ${{ data, event }}`);

  const webhookUserService = new WebhookUserService(serverDB);
  switch (event) {
    case 'User.Data.Updated': {
      return webhookUserService.safeUpdateUser(
        {
          accountId: data.id,
          providerId: 'logto',
        },
        {
          avatar: data?.avatar,
          email: data?.primaryEmail,
          fullName: data?.name,
        },
      );
    }
    case 'User.SuspensionStatus.Updated': {
      if (data.isSuspended) {
        return webhookUserService.safeSignOutUser({
          accountId: data.id,
          providerId: 'logto',
        });
      }
      return c.json({ message: 'user reactivated', success: true }, 200);
    }

    default: {
      console.warn(
        `${c.req.url} received event type "${event}", but no handler is defined for this type`,
      );
      return c.json({ error: `unrecognised payload type: ${event}` }, 400);
    }
  }
};
