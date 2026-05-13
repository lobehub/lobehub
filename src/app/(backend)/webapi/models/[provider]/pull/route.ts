import { pullModelsAPIHandler } from '@/server/api-runtime/models';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

type Params = Promise<{ provider: string }>;

export const POST = async (request: Request, segmentData: { params: Params }) => {
  const params = await segmentData.params;

  return createNextAPIRouteHandler(
    'webapi-models-pull',
    (nextRequest) => pullModelsAPIHandler(nextRequest, params),
    { honoRuntime: 'root' },
  )(request);
};
