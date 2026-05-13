import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/auth';

const jsonContentTypeRegex = /^application\/(?:[a-z0-9.+-]*\+)?json/i;

const betterAuthNextHandler = toNextJsHandler(auth);

const malformedJsonResponse = () =>
  Response.json({ code: 'INVALID_JSON', message: 'Malformed JSON request body' }, { status: 400 });

const validateJsonBody = async (request: Request) => {
  const contentType = request.headers.get('content-type') || '';
  if (!request.body || !jsonContentTypeRegex.test(contentType)) return;

  try {
    await request.clone().json();
  } catch (error) {
    if (error instanceof SyntaxError) return malformedJsonResponse();
    throw error;
  }
};

export const betterAuthAPIHandler = async (request: Request) => {
  if (request.method === 'GET') return betterAuthNextHandler.GET(request);
  if (request.method === 'POST') {
    const invalidJsonResponse = await validateJsonBody(request);
    if (invalidJsonResponse) return invalidJsonResponse;

    return betterAuthNextHandler.POST(request);
  }

  return new Response(null, { status: 405 });
};
