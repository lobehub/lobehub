import { validator } from 'hono-openapi';

/**
 * Drop-in replacement for `@hono/zod-validator`'s `zValidator`, built on
 * `hono-openapi`'s validator so every request schema is registered into the
 * generated OpenAPI spec (see `scripts/generate-openapi.ts`).
 *
 * The failure hook reproduces `@hono/zod-validator`'s default 400 response
 * shape (`{ success: false, error: { name: 'ZodError', message } }`) so the
 * swap is invisible to API consumers.
 */
export const zValidator = ((target: never, schema: never) =>
  validator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            message: JSON.stringify(result.error, null, 2),
            name: 'ZodError',
          },
          success: false,
        },
        400,
      );
    }
  })) as typeof validator;
