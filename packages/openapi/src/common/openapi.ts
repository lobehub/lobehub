import type { DescribeRouteOptions } from 'hono-openapi';
import { describeRoute, resolver } from 'hono-openapi';
import { z } from 'zod';

import { dateTimeSchema } from '../types/common.type';

/**
 * The error envelope every handler answers with — `BaseController.error`,
 * `app.onError` and the shared validator all produce exactly this shape.
 */
export const ApiErrorSchema = z
  .object({
    error: z.string(),
    success: z.literal(false),
    timestamp: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'ApiError' });

export const API_ERROR_REF = '#/components/schemas/ApiError';

export type SuccessStatus = 200 | 201 | 202;

/**
 * Error statuses a route may declare on top of the ones every authenticated
 * route shares. `400` is also derived automatically for any route with a
 * request validator, so declare it only when the handler itself rejects input.
 */
export type RouteErrorStatus = 400 | 402 | 404 | 409 | 412 | 413 | 422 | 429 | 502 | 503;

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Invalid request',
  401: 'Authentication required',
  402: 'Payment required',
  403: 'Insufficient permission',
  404: 'Resource not found',
  409: 'Resource conflict',
  412: 'Precondition failed',
  413: 'Payload too large',
  422: 'Unprocessable content',
  429: 'Rate limit exceeded',
  500: 'Internal server error',
  502: 'Upstream error',
  503: 'Service unavailable',
};

/**
 * Raised by every authenticated route regardless of its handler: the auth and
 * workspace middleware answer 401/403, and `BaseController.handleError` turns
 * any unexpected throw into a 500.
 */
const AUTHENTICATED_ERRORS = [401, 403, 500] as const;

export const errorResponse = (status: number) => ({
  content: { 'application/json': { schema: { $ref: API_ERROR_REF } } },
  description: ERROR_DESCRIPTIONS[status] ?? 'Error',
});

/** The success envelope produced by `BaseController.success`. */
export const successEnvelope = <T extends z.ZodType>(data: T) =>
  z
    .object({
      data,
      message: z.string().optional(),
      success: z.literal(true),
      timestamp: dateTimeSchema,
    })
    .strict();

export interface RouteDocOptions extends Omit<DescribeRouteOptions, 'responses'> {
  /**
   * Payload schema. Wrapped in the `{ success, data, message, timestamp }`
   * envelope unless `envelope: false`.
   */
  data: z.ZodType;
  /** Set to `false` when the handler answers with `data` as the whole body. */
  envelope?: boolean;
  /** Errors this handler can produce beyond the shared authenticated set. */
  errors?: RouteErrorStatus[];
  /** Public routes skip the shared authenticated errors (401/403/500). */
  public?: boolean;
  /** The success status the handler answers with. Defaults to 200. */
  status?: SuccessStatus;
  /** Extra success media types, e.g. `text/event-stream` for streaming routes. */
  streamContent?: Record<string, { schema: Record<string, unknown> }>;
  summary: string;
}

/**
 * Self-declared OpenAPI documentation for one route: its success status and
 * concrete payload schema, plus only the error codes it can actually return.
 * The spec is generated from these declarations — nothing is guessed from the
 * path afterwards, so a route without one fails `buildSpecDocument`.
 */
export const routeDoc = ({
  data,
  envelope = true,
  errors = [],
  public: isPublic = false,
  status = 200,
  streamContent,
  ...rest
}: RouteDocOptions) => {
  const errorStatuses = new Set<number>([...(isPublic ? [] : AUTHENTICATED_ERRORS), ...errors]);

  return describeRoute({
    ...rest,
    responses: {
      [status]: {
        content: {
          'application/json': { schema: resolver(envelope ? successEnvelope(data) : data) },
          ...streamContent,
        },
        description: 'Successful response',
      },
      ...Object.fromEntries(
        [...errorStatuses].sort().map((code) => [code, errorResponse(code)] as const),
      ),
    },
  });
};
