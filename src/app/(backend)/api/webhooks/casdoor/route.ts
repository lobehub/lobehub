import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { casdoorWebhookAPIHandler } from '@/server/api-runtime/webhooks';

export const POST = createNextAPIRouteHandler('api-webhooks-casdoor', casdoorWebhookAPIHandler);
