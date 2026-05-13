import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { videoWebhookAPIHandler } from '@/server/api-runtime/videoWebhook';

type RouteContext = {
  params: Promise<{
    provider: string;
  }>;
};

export const POST = async (request: Request, context: RouteContext) => {
  const { provider } = await context.params;

  return createNextAPIRouteHandler(
    'api-webhooks-video',
    (nextRequest) => videoWebhookAPIHandler(nextRequest, { provider }),
    { honoRuntime: 'root' },
  )(request);
};
