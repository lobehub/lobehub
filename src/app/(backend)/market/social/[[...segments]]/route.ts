import { marketSocialAPIHandler } from '@/server/api-runtime/market';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

type RouteContext = {
  params: Promise<{
    segments?: string[];
  }>;
};

const handleMarketSocialRoute = async (request: Request, context: RouteContext) => {
  const { segments } = await context.params;

  return createNextAPIRouteHandler(
    'market-social',
    (nextRequest) => marketSocialAPIHandler(nextRequest, { segments }),
    { honoRuntime: 'root' },
  )(request);
};

export const GET = handleMarketSocialRoute;
export const POST = handleMarketSocialRoute;

export const dynamic = 'force-dynamic';
