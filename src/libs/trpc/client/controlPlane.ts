import { createTRPCClient, httpBatchLink, httpLink, splitLink } from '@trpc/client';
import superjson from 'superjson';

import type { PlatformAdminRouter } from '@/server/routers/lambda/platformAdmin';

/** Control-plane tRPC surface (platform admin only). */
export type ControlPlaneRouter = {
  platformAdmin: PlatformAdminRouter;
};

/**
 * tRPC client for the Aico control plane.
 * In `SPA_TARGET=control-plane`, Vite proxies `/trpc` → control-plane :3020.
 */
const linkOptions = {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: 'include' }),
  transformer: superjson,
  url: '/trpc/lambda',
};

export const controlPlaneClient = createTRPCClient<ControlPlaneRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === 'query',
      false: httpLink(linkOptions),
      true: httpBatchLink({ ...linkOptions, maxURLLength: 2083 }),
    }),
  ],
});
