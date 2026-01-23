import type { NextRequest } from 'next/server';

import { enableBetterAuth } from '@/envs/auth';

const createHandler = async () => {
  if (enableBetterAuth) {
    const [{ toNextJsHandler }, { auth }] = await Promise.all([
      import('better-auth/next-js'),
      import('@/auth'),
    ]);
    return toNextJsHandler(auth);
  }

  return { GET: undefined, POST: undefined };
};

const handler = createHandler();

export const GET = async (req: NextRequest) => {
  const { GET } = await handler;
  return GET?.(req);
};

export const POST = async (req: NextRequest) => {
  const { POST } = await handler;
  return POST?.(req);
};
