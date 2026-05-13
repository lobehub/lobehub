import { modelsAPIHandler } from '@/server/api-runtime/models';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

type Params = Promise<{ provider: string }>;

export const GET = async (request: Request, segmentData: { params: Params }) => {
  const params = await segmentData.params;

  return createNextAPIRouteHandler(
    'webapi-models',
    (nextRequest) => modelsAPIHandler(nextRequest, params),
    { honoRuntime: 'root' },
  )(request);
};
