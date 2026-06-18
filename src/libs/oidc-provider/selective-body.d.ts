/**
 * Minimal declaration for the untyped `oidc-provider` internal module used in
 * `http-adapter.test.ts` — `@types/oidc-provider` does not cover deep imports.
 *
 * Source: https://github.com/panva/node-oidc-provider/blob/main/lib/shared/selective_body.js
 */
declare module 'oidc-provider/lib/shared/selective_body.js' {
  import type { IncomingMessage } from 'node:http';

  export interface SelectiveBodyContext {
    charset?: string;
    get?: (header: string) => string;
    is: (contentType: string) => string | boolean | null;
    method?: string;
    oidc: { body?: unknown };
    path?: string;
    req: IncomingMessage;
    request: { body?: unknown; length?: number };
  }

  export type SelectiveBodyMiddleware = (
    ctx: SelectiveBodyContext,
    next: () => Promise<void>,
  ) => Promise<void>;

  export const json: SelectiveBodyMiddleware;
  export const urlencoded: SelectiveBodyMiddleware;

  const selectiveBody: (
    cty: string,
    ctx: SelectiveBodyContext,
    next: () => Promise<void>,
  ) => Promise<void>;

  export default selectiveBody;
}
