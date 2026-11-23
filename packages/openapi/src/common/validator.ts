import { validator } from 'hono-openapi';

import { detailsFromZodIssues, renderApiError } from './errors';

/**
 * Drop-in replacement for `@hono/zod-validator`'s `zValidator`, built on
 * `hono-openapi`'s validator so every request schema is registered into the
 * generated OpenAPI spec (see `scripts/generate-openapi.ts`).
 *
 * Validation failures use the shared `ApiError` envelope with
 * `code: 'validation_error'` and one `details` entry per failing field, so a
 * client can point at the field instead of parsing the message.
 */
export const zValidator = ((target: string, schema: never) =>
  validator(target as never, schema, (result, c) => {
    if (!result.success) {
      const details = detailsFromZodIssues(target, result.error);
      const [first] = details;
      return renderApiError(c, {
        code: 'validation_error',
        details,
        message: first
          ? `Invalid request: ${first.path} ${first.message}${details.length > 1 ? ` (and ${details.length - 1} more)` : ''}`
          : 'Invalid request',
        status: 400,
      });
    }
  })) as typeof validator;
