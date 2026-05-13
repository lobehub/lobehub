import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { userAvatarAPIHandler } from '@/server/api-runtime/userAvatar';

type Params = Promise<{ id: string; image: string }>;

export const GET = async (request: Request, segmentData: { params: Params }) => {
  const params = await segmentData.params;

  return createNextAPIRouteHandler(
    'webapi-user-avatar',
    (nextRequest) => userAvatarAPIHandler(nextRequest, params),
    { honoRuntime: 'root' },
  )(request);
};
