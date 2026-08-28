import { validator } from 'hono-openapi';

/**
 * Drop-in replacement for `@hono/zod-validator`'s `zValidator`, built on
 * `hono-openapi`'s validator so every request schema is registered into the
 * generated OpenAPI spec (see `scripts/generate-openapi.ts`).
 *
 * Validation failures use the same public error envelope as controller errors.
 * Keeping `error` a string and including `timestamp` makes runtime responses
 * conform to the shared `ApiError` schema advertised by the generated spec.
 */
export const zValidator = ((target: never, schema: never) =>
  validator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: JSON.stringify(result.error, null, 2),
          success: false,
          timestamp: new Date().toISOString(),
        },
        400,
      );
    }
  })) as typeof validator;
