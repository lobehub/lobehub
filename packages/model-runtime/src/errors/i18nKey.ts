import { getErrorCodeSpec } from './specs';

export interface RuntimeErrorI18nKey {
  /** Flat key inside `ns`, e.g. `InvalidProviderAPIKey` or `response.401`. */
  key: string;
  ns: 'error' | 'modelRuntime';
}

/**
 * Locate the localized message for an error type.
 *
 * Runtime error codes (everything in `ERROR_CODE_SPECS`) live in the dedicated
 * `modelRuntime` namespace, one key per canonical code. HTTP statuses, `Plugin*`
 * and Cloud-only `ChatErrorType` values stay in the legacy `error:response.<X>`
 * map. Deprecated aliases (`PipelineError`, `QuotaLimitReached`) resolve to their
 * canonical code so the lookup hits the key that actually exists.
 *
 * Shared by the React-side `getRuntimeErrorMessage` and the non-React
 * `getMessageError` in `@lobechat/fetch-sse`, so the routing rule has a single
 * source of truth.
 */
export const getRuntimeErrorI18nKey = (code: string | number): RuntimeErrorI18nKey => {
  const spec = typeof code === 'string' ? getErrorCodeSpec(code) : undefined;

  return spec ? { key: spec.code, ns: 'modelRuntime' } : { key: `response.${code}`, ns: 'error' };
};
