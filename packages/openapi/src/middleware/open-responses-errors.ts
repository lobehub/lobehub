import type { Context, Next } from 'hono';
import { z } from 'zod';

import type { ErrorRenderer } from '../common/errors';
import { ApiErrorCodeSchema, getRequestId } from '../common/errors';

const OPEN_RESPONSES_ERROR_TYPES = [
  'invalid_request_error',
  'not_found',
  'rate_limit_error',
  'server_error',
] as const;

type OpenResponsesErrorType = (typeof OPEN_RESPONSES_ERROR_TYPES)[number];

/**
 * The HTTP error body of the OpenResponses routes. The protocol owns the
 * `error` object (`type` + `message`); `code` is our catalogue code and
 * `requestId` matches the `X-Request-Id` header, as on every other route.
 */
export const OpenResponsesHttpErrorSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        message: z.string(),
        param: z.string().nullable(),
        type: z.enum(OPEN_RESPONSES_ERROR_TYPES),
      })
      .strict(),
    requestId: z.string(),
  })
  .strict();

const typeForStatus = (status: number): OpenResponsesErrorType => {
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit_error';
  if (status >= 500) return 'server_error';
  return 'invalid_request_error';
};

const renderOpenResponsesError: ErrorRenderer = ({ code, message, status }, c) => ({
  error: { code, message, param: null, type: typeForStatus(status) },
  requestId: getRequestId(c),
});

/**
 * Switch the error format to the OpenResponses one for the routes below it.
 * Registered on the app before authentication, so even a workspace refusal
 * reaches an OpenResponses client in the shape its SDK parses.
 */
export const openResponsesErrors = async (c: Context, next: Next) => {
  c.set('errorRenderer', renderOpenResponsesError);
  return next();
};
