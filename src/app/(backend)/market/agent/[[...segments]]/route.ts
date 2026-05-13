import { marketAgentAPIHandler } from '@/server/api-runtime/market';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

type RouteContext = {
  params: Promise<{
    segments?: string[];
  }>;
};

const handleAgentRoute = async (request: Request, context: RouteContext) => {
  const { segments } = await context.params;

  return createNextAPIRouteHandler(
    'market-agent',
    (nextRequest) => marketAgentAPIHandler(nextRequest, { segments }),
    { honoRuntime: 'root' },
  )(request);
};

export const GET = handleAgentRoute;
export const POST = handleAgentRoute;

export const dynamic = 'force-dynamic';
