import { getRuntimeErrorI18nKey } from '@lobechat/model-runtime';

/**
 * Loose `t` shape that accepts any key / vars — the type-safe key inference in
 * `i18next.CustomTypeOptions` doesn't help here because we look up dynamically.
 */
type LooseT = (key: string, vars?: Record<string, unknown>) => string;

/**
 * Resolve the localized message for an error type, routing between the new
 * `runtimeError` namespace (one key per `AgentRuntimeErrorType`) and the legacy
 * `error.response.<X>` map. The routing rule itself lives in
 * `getRuntimeErrorI18nKey` so it stays in sync with the non-React
 * `getMessageError` in `@lobechat/fetch-sse`.
 *
 * The caller should pre-load both namespaces:
 * `useTranslation(['error', 'runtimeError'])`.
 */
export const getRuntimeErrorMessage = (
  t: unknown,
  code: string | number | undefined,
  vars?: Record<string, unknown>,
  fallbackMessage = '',
): string => {
  if (code === undefined || code === null || code === '') return '';
  const { key, ns } = getRuntimeErrorI18nKey(code);
  // `error` is the default namespace for these callers, so only `runtimeError`
  // needs an explicit prefix.
  const fullKey = ns === 'runtimeError' ? `runtimeError:${key}` : key;
  return (t as LooseT)(fullKey, { ...vars, defaultValue: fallbackMessage });
};
