import { NextResponse } from 'next/server';

import { serverDB } from '@/database/server';
import { authEnv } from '@/envs/auth';
import { pino } from '@/libs/logger';
import { WebhookUserService } from '@/server/services/webhookUser';

import { validateRequest } from './validateRequest';

export const POST = async (req: Request): Promise<NextResponse> => {
  const payload = await validateRequest(req, authEnv.CASDOOR_WEBHOOK_SECRET);

  if (!payload) {
    return NextResponse.json(
      { error: 'webhook verification failed or payload was malformed' },
      { status: 400 },
    );
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
      pino.warn(
        `${req.url} received event type "${action}", but no handler is defined for this type`,
      );
      return NextResponse.json({ error: `unrecognised payload type: ${action}` }, { status: 400 });
    }
  }
};
