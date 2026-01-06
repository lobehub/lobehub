import { enableBetterAuth, enableNextAuth } from '@lobechat/const';
import type { NextRequest } from 'next/server';

const createHandler = async () => {
  if (enableBetterAuth) {
    const [{ toNextJsHandler }, { auth }] = await Promise.all([
      import('better-auth/next-js'),
      import('@/auth'),
    ]);
    return toNextJsHandler(auth);
  }

  if (enableNextAuth) {
    const NextAuthNode = await import('@/libs/next-auth');
    return NextAuthNode.default.handlers;
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
