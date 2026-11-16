import { createHmac } from 'node:crypto';

/** Independent Standard Webhooks signer so verification tests do not reproduce library internals. */
export const receiverTestSecret = `whsec_${Buffer.alloc(32, 42).toString('base64')}`;

export const signedWebhookHeaders = (
  body: string,
  options: { id?: string; secret?: string; timestamp?: number } = {},
) => {
  const id = options.id ?? 'delivery-1';
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const key = Buffer.from((options.secret ?? receiverTestSecret).replace(/^whsec_/, ''), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return new Headers({
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-signature': `v1,${signature}`,
    'webhook-timestamp': String(timestamp),
  });
};
