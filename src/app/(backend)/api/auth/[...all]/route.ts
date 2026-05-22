import { toNextJsHandler } from 'better-auth/next-js';
import type { NextRequest } from 'next/server';

import { auth } from '@/auth';

const jsonContentTypeRegex = /^application\/(?:[a-z0-9.+-]*\+)?json/i;

const handler = toNextJsHandler(auth);

const malformedJsonResponse = () =>
  Response.json({ code: 'INVALID_JSON', message: 'Malformed JSON request body' }, { status: 400 });

/**
 * better-call currently treats Request.json() SyntaxError as a server error.
 * Validate JSON bodies at the route boundary so malformed client payloads stay 400s.
 */
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

export const GET = handler.GET;

export const POST = async (request: NextRequest) => {
  const invalidJsonResponse = await validateJsonBody(request);
  if (invalidJsonResponse) return invalidJsonResponse;

  return handler.POST(request);
};
