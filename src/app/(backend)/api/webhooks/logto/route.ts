import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { logtoWebhookAPIHandler } from '@/server/api-runtime/webhooks';

export const POST = createNextAPIRouteHandler('api-webhooks-logto', logtoWebhookAPIHandler);
