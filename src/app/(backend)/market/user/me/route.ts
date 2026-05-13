import { marketUserMeAPIHandler } from '@/server/api-runtime/market';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

export const PUT = createNextAPIRouteHandler('market-user-me', marketUserMeAPIHandler, {
  honoRuntime: 'root',
});

export const dynamic = 'force-dynamic';
