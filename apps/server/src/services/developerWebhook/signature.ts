import { createHmac, randomBytes } from 'node:crypto';

import { WEBHOOK_SIGNATURE_VERSION } from '@lobechat/types';

const SECRET_PREFIX = 'whsec_';

/** A new signing secret: `whsec_` + 32 random bytes, base64url. */
export const generateWebhookSecret = () =>
  `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;

/** What the owner sees of a secret after creation: its last four characters. */
export const webhookSecretHint = (secret: string) => secret.slice(-4);

/**
 * `v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`. The timestamp is inside the
 * signed string, so a captured request cannot be replayed with a fresh timestamp.
 */
export const signWebhookPayload = (secret: string, timestamp: number, body: string) =>
  `${WEBHOOK_SIGNATURE_VERSION}=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
