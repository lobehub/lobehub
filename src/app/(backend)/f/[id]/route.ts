import { fileProxyAPIHandler } from '@/server/api-runtime/fileProxy';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

type Params = Promise<{ id: string }>;

export const GET = async (request: Request, segmentData: { params: Params }) => {
  const params = await segmentData.params;

  return createNextAPIRouteHandler(
    'file-proxy',
    (nextRequest) => fileProxyAPIHandler(nextRequest, params),
    { honoRuntime: 'root' },
  )(request);
};
