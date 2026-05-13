import { createHmac } from 'node:crypto';

import { serverDB } from '@/database/server';
import { authEnv } from '@/envs/auth';
import { WebhookUserService } from '@/server/services/webhookUser';

export interface CasdoorUserEntity {
  avatar?: string;
  displayName: string;
  email?: string;
  id: string;
}

interface CasdoorWebhookPayload {
  action: string;
  object: CasdoorUserEntity;
}

export interface LogtoUserEntity {
  applicationId?: string;
  avatar?: string;
  createdAt?: string;
  customData?: object;
  id: string;
  identities?: object;
  isSuspended?: boolean;
  lastSignInAt?: string;
  name?: string;
  primaryEmail?: string;
  primaryPhone?: string;
  username?: string;
}

interface LogtoWebhookPayload {
  data: LogtoUserEntity;
  event: string;
}

const validateCasdoorRequest = async (request: Request, secret?: string) => {
  const payloadString = await request.text();
  const casdoorSecret = request.headers.get('casdoor-secret');

  try {
    if (casdoorSecret === secret) {
      return JSON.parse(payloadString, (key, value) =>
        key === 'object' && typeof value === 'string' ? JSON.parse(value) : value,
      ) as CasdoorWebhookPayload;
    }

    console.warn(
      '[Casdoor]: secret verify failed, please check your secret in `CASDOOR_WEBHOOK_SECRET`',
    );
  } catch (error) {
    if (!authEnv.CASDOOR_WEBHOOK_SECRET) {
      throw new Error('`CASDOOR_WEBHOOK_SECRET` environment variable is missing.', {
        cause: error,
      });
    }

    console.error('[Casdoor]: incoming webhook failed in verification.\n', error, payloadString);
  }
};

const validateLogtoRequest = async (request: Request, signingKey?: string) => {
  const payloadString = await request.text();
  const logtoHeaderSignature = request.headers.get('logto-signature-sha-256');

  try {
    const hmac = createHmac('sha256', signingKey ?? '');
    hmac.update(payloadString);
    const signature = hmac.digest('hex');
    if (signature === logtoHeaderSignature) {
      return JSON.parse(payloadString) as LogtoWebhookPayload;
    }

    console.warn(
      '[logto]: signature verify failed, please check your logto signature in `LOGTO_WEBHOOK_SIGNING_KEY`',
    );
  } catch (error) {
    if (!authEnv.LOGTO_WEBHOOK_SIGNING_KEY) {
      throw new Error('`LOGTO_WEBHOOK_SIGNING_KEY` environment variable is missing.', {
        cause: error,
      });
    }

    console.error('[logto]: incoming webhook failed in verification.\n', error);
  }
};

export const casdoorWebhookAPIHandler = async (request: Request): Promise<Response> => {
  const payload = await validateCasdoorRequest(request, authEnv.CASDOOR_WEBHOOK_SECRET);

  if (!payload) {
    return Response.json(
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
      console.warn(
        `${request.url} received event type "${action}", but no handler is defined for this type`,
      );
      return Response.json({ error: `unrecognised payload type: ${action}` }, { status: 400 });
    }
  }
};

export const logtoWebhookAPIHandler = async (request: Request): Promise<Response> => {
  const payload = await validateLogtoRequest(request, authEnv.LOGTO_WEBHOOK_SIGNING_KEY);

  if (!payload) {
    return Response.json(
      { error: 'webhook verification failed or payload was malformed' },
      { status: 400 },
    );
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

      return Response.json({ message: 'user reactivated', success: true }, { status: 200 });
    }

    default: {
      console.warn(
        `${request.url} received event type "${event}", but no handler is defined for this type`,
      );
      return Response.json({ error: `unrecognised payload type: ${event}` }, { status: 400 });
    }
  }
};
