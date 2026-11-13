import type { InboundWebhookVerification } from '@lobechat/types';
import { Webhook } from 'standardwebhooks';

/** Verify the exact bytes before any JSON parsing. Standard Webhooks enforces its time window. */
export function verifyInboundWebhook(params: {
  body: string;
  headers: Headers;
  secret: string | null;
  verification: InboundWebhookVerification;
}): boolean {
  if (params.verification.scheme !== 'standard_webhooks' || !params.secret) return false;
  try {
    new Webhook(params.secret).verify(
      params.body,
      {
        'webhook-id': params.headers.get('webhook-id') ?? '',
        'webhook-signature': params.headers.get('webhook-signature') ?? '',
        'webhook-timestamp': params.headers.get('webhook-timestamp') ?? '',
      },
      { jsonParse: false },
    );
    return true;
  } catch {
    return false;
  }
}
