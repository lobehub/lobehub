import { headers } from 'next/headers';

import { authEnv } from '@/envs/auth';

export type CasdoorUserEntity = {
  avatar?: string;
  displayName: string;
  email?: string;
  id: string;
};

interface CasdoorWebhookPayload {
  action: string;
  // The object is the user entity that is updated.
  // ref: https://github.com/casdoor/casdoor/issues/1918#issuecomment-1572218847
  object: CasdoorUserEntity;
}

export const validateRequest = async (request: Request, secret?: string) => {
  const payloadString = await request.text();
  const headerPayload = await headers();
  const casdoorSecret = headerPayload.get('casdoor-secret')!;
  try {
    if (casdoorSecret === secret) {
      return JSON.parse(payloadString, (k, v) =>
        k === 'object' && typeof v === 'string' ? JSON.parse(v) : v,
      ) as CasdoorWebhookPayload;
    } else {
      console.warn(
        '[Casdoor]: secret verify failed, please check your secret in `CASDOOR_WEBHOOK_SECRET`',
      );
      return;
    }
  } catch (e) {
    if (!authEnv.CASDOOR_WEBHOOK_SECRET) {
      throw new Error('`CASDOOR_WEBHOOK_SECRET` environment variable is missing.', { cause: e });
    }
    console.error('[Casdoor]: incoming webhook failed in verification.\n', e, payloadString);
    return;
  }
};
