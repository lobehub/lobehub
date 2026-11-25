import type { DescribeRouteOptions } from 'hono-openapi';
import { describeRoute, resolver } from 'hono-openapi';
import { z } from 'zod';

import { dateTimeSchema } from '../types/common.type';

export { ApiErrorSchema } from './errors';

/** Registered as `components/schemas/ApiError` by `buildSpecDocument`. */
export const API_ERROR_REF = '#/components/schemas/ApiError';

export type SuccessStatus = 200 | 201 | 202;

/**
 * Carries `routeDoc({ requestExample })` to `buildSpecDocument`, which moves
 * it onto the JSON request body the validator documents (the body schema is
 * not known when `routeDoc` runs).
 */
export const REQUEST_EXAMPLE_EXTENSION = 'x-request-example';

/**
 * Documentation mistakes found while routes are declared (an example that does
 * not match its schema, an undocumentable scope gate). Recorded here instead of
 * thrown, so a doc slip can never stop the API server from booting;
 * `buildSpecDocument` fails on them, which CI runs on every PR.
 */
export const SPEC_ERROR_EXTENSION = 'x-spec-error';

/** A request body example plus, when it does not match its schema, why. */
export interface RequestExample {
  error?: string;
  value: unknown;
}

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
 * workspace middleware answer 401/403, the per-API-key rate limit
 * (`middleware/rate-limit.ts`, applied to every authenticated route) answers
 * 429, and `BaseController.handleError` turns any unexpected throw into a 500.
 */
const AUTHENTICATED_ERRORS = [401, 403, 429, 500] as const;

export const errorResponse = (status: number) => ({
  content: { 'application/json': { schema: { $ref: API_ERROR_REF } } },
  description: ERROR_DESCRIPTIONS[status] ?? 'Error',
});

/** An error response with a route-specific body instead of the shared `ApiError`. */
const customErrorResponse = (status: number, schema: z.ZodType) => ({
  content: { 'application/json': { schema: resolver(schema) } },
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
  /** Error body schema for routes speaking another protocol; defaults to `ApiError`. */
  errorSchema?: z.ZodType;
  /**
   * `<resource>.<method>` when the mechanical name from `{method} {path}` reads
   * wrong (see `common/operation-id.ts`). It is the SDK method name: never
   * rename one that has shipped.
   */
  operationId?: `${string}.${string}`;
  /** Public routes skip the shared authenticated errors (401/403/500). */
  public?: boolean;
  /** Example JSON request body, built with `example(schema, value)` from `common/examples.ts`. */
  requestExample?: RequestExample;
  /** Example success payload (`data`); wrapped in the success envelope like the schema. */
  responseExample?: unknown;
  /** The success status the handler answers with. Defaults to 200. */
  status?: SuccessStatus;
  /** Extra success media types, e.g. `text/event-stream` for streaming routes. */
  streamContent?: Record<string, { schema: z.ZodType }>;
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
  errorSchema,
  errors = [],
  public: isPublic = false,
  requestExample,
  responseExample,
  status = 200,
  streamContent,
  ...rest
}: RouteDocOptions) => {
  const errorStatuses = new Set<number>([...(isPublic ? [] : AUTHENTICATED_ERRORS), ...errors]);
  const specErrors: string[] = [];
  if (requestExample?.error) specErrors.push(requestExample.error);
  if (responseExample !== undefined) {
    const parsed = data.safeParse(responseExample);
    if (!parsed.success)
      specErrors.push(`responseExample does not match data: ${parsed.error.message}`);
  }
  const example =
    responseExample === undefined
      ? undefined
      : envelope
        ? {
            data: responseExample,
            success: true,
            timestamp: '2026-01-01T00:00:00.000Z',
          }
        : responseExample;

  return describeRoute({
    // Public routes need no credentials, so they also skip the API-key rate
    // limit and Idempotency-Key the spec builder adds to authenticated ones.
    ...(isPublic ? { security: [] } : {}),
    ...rest,
    ...(requestExample === undefined ? {} : { [REQUEST_EXAMPLE_EXTENSION]: requestExample.value }),
    ...(specErrors.length > 0 ? { [SPEC_ERROR_EXTENSION]: specErrors } : {}),
    responses: {
      [status]: {
        content: {
          'application/json': {
            schema: resolver(envelope ? successEnvelope(data) : data),
            ...(example === undefined ? {} : { example }),
          },
          ...Object.fromEntries(
            Object.entries(streamContent ?? {}).map(([type, media]) => [
              type,
              { schema: resolver(media.schema) },
            ]),
          ),
        },
        description: 'Successful response',
      },
      ...Object.fromEntries(
        [...errorStatuses]
          .sort()
          .map(
            (code) =>
              [
                code,
                errorSchema ? customErrorResponse(code, errorSchema) : errorResponse(code),
              ] as const,
          ),
      ),
    },
  });
};
