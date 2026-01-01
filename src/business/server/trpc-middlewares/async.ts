import { asyncTrpc } from '@/libs/trpc/async/init';

export const checkEmbeddingUsage = asyncTrpc.middleware(async (opts) => {
  return opts.next();
});

export const checkBudgetsUsage = asyncTrpc.middleware(async (opts) => {
  return opts.next();
});

export const createImageBusinessMiddleware = asyncTrpc.middleware(async (opts) => {
  return opts.next();
});
