import { marketUserProfileAPIHandler } from '@/server/api-runtime/market';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

type RouteContext = {
  params: Promise<{
    username: string;
  }>;
};

export const GET = async (request: Request, context: RouteContext) => {
  const { username } = await context.params;

  return createNextAPIRouteHandler(
    'market-user-profile',
    (nextRequest) => marketUserProfileAPIHandler(nextRequest, { username }),
    { honoRuntime: 'root' },
  )(request);
};

export const dynamic = 'force-dynamic';
