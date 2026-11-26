import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';

import type { LambdaRouter } from '@/server/routers/lambda';

import { reject } from './reject';

export const lambdaClient = createTRPCClient<LambdaRouter>({
  links: [
    httpLink({
      fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
      transformer: superjson,
      url: '/trpc/lambda',
    }),
  ],
});

export const createWorkspaceLambdaClient = reject('createWorkspaceLambdaClient');
// Workbench has one scope: an unpinned call uses it, a pinned one has no workspace to reach.
export const scopedLambdaClient = (workspaceId?: string | null) =>
  workspaceId === undefined ? lambdaClient : createWorkspaceLambdaClient(workspaceId);
export const asyncClient = reject('asyncClient');
export const toolsClient = reject('toolsClient');
export const lambdaQuery = reject('lambdaQuery');

// Workbench never relays an LLM call to a tab, so a call carries no relay headers.
export const withLlmRelay = (_relay?: {
  headers: Record<string, string>;
}): { context: Record<string, unknown> } | undefined => undefined;
