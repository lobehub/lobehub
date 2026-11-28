import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

// Same as `dateTimeSchema` in `types/common.type`, declared here so the type
// modules can import the pagination helpers (which raise `ApiException`)
// without an import cycle.
const dateTimeSchema = z.string().meta({ format: 'date-time' });

/**
 * The error code catalogue. `code` is the stable, machine-readable half of
 * every error body: clients branch on it, never on the English `message`.
 * Codes are only ever added — renaming or removing one is a breaking change.
 */
export const API_ERROR_CODES = {
  bad_request: { description: 'The request was understood but cannot be processed as sent.' },
  conflict: { description: 'The request conflicts with the current state of the resource.' },
  forbidden: { description: 'The caller is authenticated but may not perform this operation.' },
  idempotency_conflict: {
    description:
      'The `Idempotency-Key` is still being processed, or was first used with a different request.',
  },
  insufficient_scope: {
    description: 'The API key lacks a capability scope this operation requires.',
  },
  internal_error: { description: 'An unexpected server error. Safe to retry with backoff.' },
  not_found: { description: 'The resource does not exist or is not visible to the caller.' },
  payload_too_large: { description: 'The request body exceeds the size this operation accepts.' },
  payment_required: { description: 'The operation needs credits or a plan the caller lacks.' },
  precondition_failed: { description: 'A precondition of the operation is not met.' },
  rate_limited: {
    description:
      'Too many requests for this API key. Retry after the `Retry-After` header (seconds).',
  },
  service_unavailable: { description: 'A dependency is temporarily unavailable.' },
  unauthorized: { description: 'Authentication is missing, invalid or expired.' },
  unprocessable_entity: {
    description: 'The request is valid but cannot be applied to the resource.',
  },
  upstream_error: { description: 'An upstream provider failed while serving the request.' },
  validation_error: {
    description: 'The request failed schema validation; `details` lists each failing field.',
  },
  workspace_mismatch: {
    description:
      'The `X-Workspace-Id` header does not match the API key, or the caller is not a member of that workspace.',
  },
} as const satisfies Record<string, { description: string }>;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;

const ERROR_CODE_VALUES = Object.keys(API_ERROR_CODES) as [ApiErrorCode, ...ApiErrorCode[]];

export const ApiErrorCodeSchema = z.enum(ERROR_CODE_VALUES);

/** The code an error gets when its thrower names none. */
const STATUS_TO_CODE: Record<number, ApiErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  402: 'payment_required',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  412: 'precondition_failed',
  413: 'payload_too_large',
  422: 'unprocessable_entity',
  429: 'rate_limited',
  500: 'internal_error',
  502: 'upstream_error',
  503: 'service_unavailable',
};

export const codeForStatus = (status: number): ApiErrorCode =>
  STATUS_TO_CODE[status] ??
  (status >= 500 ? 'internal_error' : status === 429 ? 'rate_limited' : 'bad_request');

export const ApiErrorDetailSchema = z
  .object({
    /** Dotted path of the failing field, e.g. `body.messages.0.role`; empty for the request itself. */
    message: z.string(),
    path: z.string(),
  })
  .strict();

export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

/**
 * The error envelope every handler answers with — `BaseController.error`,
 * `app.onError` and the shared validator all produce exactly this shape.
 *
 * `error` keeps the pre-`code` string field so existing clients that print it
 * keep working; it always equals `message`.
 */
export const ApiErrorSchema = z
  .object({
    code: ApiErrorCodeSchema,
    details: z.array(ApiErrorDetailSchema).optional(),
    error: z.string(),
    message: z.string(),
    requestId: z.string(),
    success: z.literal(false),
    timestamp: dateTimeSchema,
  })
  .strict();

export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

/**
 * An HTTP error that carries its catalogue code (and optional field details)
 * to whichever layer renders it — controller, validator or `app.onError`.
 */
export class ApiException extends HTTPException {
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetail[];

  constructor(
    status: ContentfulStatusCode,
    code: ApiErrorCode,
    message: string,
    details?: ApiErrorDetail[],
  ) {
    super(status, { message });
    this.code = code;
    this.details = details;
  }
}

/**
 * Infer a catalogue code for an error thrown without one. Scope refusals are
 * prefixed `insufficient_scope:` by the permission middleware, which keeps
 * their message readable while still mapping to their own code.
 */
const inferCode = (status: number, message: string): ApiErrorCode => {
  if (status === 403 && message.startsWith('insufficient_scope')) return 'insufficient_scope';
  return codeForStatus(status);
};

export const getRequestId = (c: Context): string => c.get('requestId') ?? '';

export interface ApiErrorInit {
  code?: ApiErrorCode;
  details?: ApiErrorDetail[];
  message: string;
  status: number;
}

/**
 * Routes speaking another protocol's wire format (OpenResponses) register a
 * renderer for their error bodies through `c.set('errorRenderer', ...)`.
 */
export type ErrorRenderer = (init: Required<Omit<ApiErrorInit, 'details'>>, c: Context) => unknown;

export const buildApiErrorBody = (c: Context, init: ApiErrorInit): ApiErrorBody => ({
  code: init.code ?? inferCode(init.status, init.message),
  ...(init.details?.length ? { details: init.details } : {}),
  error: init.message,
  message: init.message,
  requestId: getRequestId(c),
  success: false,
  timestamp: new Date().toISOString(),
});

/** Render an error in the route's wire format (the shared `ApiError` unless overridden). */
export const renderApiError = (c: Context, init: ApiErrorInit): Response => {
  const renderer = c.get('errorRenderer') as ErrorRenderer | undefined;
  const code = init.code ?? inferCode(init.status, init.message);
  const body = renderer
    ? renderer({ code, message: init.message, status: init.status }, c)
    : buildApiErrorBody(c, { ...init, code });

  return c.json(body as object, init.status as ContentfulStatusCode);
};

/** Turn an `HTTPException` (or `ApiException`) into the error it should render as. */
export const errorInitFromException = (error: HTTPException): ApiErrorInit => ({
  code: error instanceof ApiException ? error.code : undefined,
  details: error instanceof ApiException ? error.details : undefined,
  message: error.message,
  status: error.status,
});

/** Zod issues → `details`; paths are dotted and prefixed by the request part. */
export const detailsFromZodIssues = (
  target: string,
  issues: ReadonlyArray<{
    message: string;
    path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
  }>,
): ApiErrorDetail[] =>
  issues.map((issue) => ({
    message: issue.message,
    path: [
      target,
      ...(issue.path ?? []).map((segment) =>
        typeof segment === 'object' && segment !== null ? String(segment.key) : String(segment),
      ),
    ].join('.'),
  }));
