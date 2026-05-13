import { chatAPIHandler } from '@/server/api-runtime/chat';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

type Params = Promise<{ provider: string }>;

// If user don't use fluid compute, will build  failed
// this enforce user to enable fluid compute
export const maxDuration = 300;

export const POST = async (request: Request, segmentData: { params: Params }) => {
  const params = await segmentData.params;

  return createNextAPIRouteHandler(
    'webapi-chat',
    (nextRequest) => chatAPIHandler(nextRequest, params),
    { honoRuntime: 'root' },
  )(request);
};
