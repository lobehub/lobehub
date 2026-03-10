import { toNextJsHandler } from 'better-auth/next-js';
import { type NextRequest } from 'next/server';

import { auth } from '@/auth';

const handler = toNextJsHandler(auth);

export const GET = async (req: NextRequest) => {
  return handler.GET(req);
};

export const POST = async (req: NextRequest) => {
  return handler.POST(req);
};
