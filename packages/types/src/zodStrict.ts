/**
 * zod 4's type inference requires `strictNullChecks`: without it, object keys
 * behind `ZodPipe` / `ZodLazy` all degrade to optional, so structural guards
 * like `satisfies z.ZodType<T>` report false mismatches. This alias keeps the
 * guard intact in strict projects (the repo root) and relaxes it to `any` for
 * non-strict consumers that compile these sources (e.g. the desktop main
 * tsconfig). `undefined extends string` is true exactly when
 * `strictNullChecks` is off.
 */
export type StrictOnly<T> = undefined extends string ? any : T;
