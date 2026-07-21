import { getErrorCodeSpec } from '@lobechat/model-runtime';

/**
 * Loose `t` shape that accepts any key / vars — the type-safe key inference in
 * `i18next.CustomTypeOptions` doesn't help here because we look up dynamically.
 */
type LooseT = (key: string, vars?: Record<string, unknown>) => string;

/**
 * Resolve the localized message for an error type, routing between the new
 * `modelRuntime` namespace (one key per `AgentRuntimeErrorType`) and the legacy
 * `error.response.<X>` map.
 *
 * - If `code` is a known runtime code (present in `ERROR_CODE_SPECS`), the
 *   message lives under `modelRuntime:<code>`.
 * - Otherwise (HTTP status code, Plugin*, Cloud-only ChatErrorType, etc.) it
 *   stays in the legacy `error.response.<X>` location.
 *
 * The caller should pre-load both namespaces:
 * `useTranslation(['error', 'modelRuntime'])`.
 */
export const getRuntimeErrorMessage = (
  t: unknown,
  code: string | number | undefined,
  vars?: Record<string, unknown>,
  fallbackMessage = '',
): string => {
  if (code === undefined || code === null || code === '') return '';
  const key =
    typeof code === 'string' && getErrorCodeSpec(code)
      ? `modelRuntime:${code}`
      : `response.${code}`;
  return (t as LooseT)(key, { ...vars, defaultValue: fallbackMessage });
};
