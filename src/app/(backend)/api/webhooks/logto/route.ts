import { NextResponse } from 'next/server';

import { serverDB } from '@/database/server';
import { authEnv } from '@/envs/auth';
import { pino } from '@/libs/logger';
import { WebhookUserService } from '@/server/services/webhookUser';

import { validateRequest } from './validateRequest';

export const POST = async (req: Request): Promise<NextResponse> => {
  const payload = await validateRequest(req, authEnv.LOGTO_WEBHOOK_SIGNING_KEY!);

  if (!payload) {
    return NextResponse.json(
      { error: 'webhook verification failed or payload was malformed' },
      { status: 400 },
    );
  }

  const { event, data } = payload;

  pino.trace(`logto webhook payload: ${{ data, event }}`);

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
      return NextResponse.json({ message: 'user reactivated', success: true }, { status: 200 });
    }

    default: {
      pino.warn(
        `${req.url} received event type "${event}", but no handler is defined for this type`,
      );
      return NextResponse.json({ error: `unrecognised payload type: ${event}` }, { status: 400 });
    }
  }
};
