import { type NextRequest } from 'next/server';

/**
 * Prepare Request object for tRPC fetchRequestHandler
 *
 * This function solves the "Response body object should not be disturbed or locked" error
 * that occurs in Next.js 16 when the request body stream has been consumed or locked
 * by Next.js internal mechanisms.
 *
 * By cloning the Request object, we create an independent body stream that tRPC can safely read.
 *
 * @see https://github.com/vercel/next.js/issues/83453
 * @param req - The original NextRequest object
 * @returns A cloned Request object with an independent body stream
 */
export function prepareRequestForTRPC(req: NextRequest): Request {
  // Clone the Request to create an independent body stream
  // This ensures tRPC can read the body even if the original request's body was disturbed
  return req.clone();
}
