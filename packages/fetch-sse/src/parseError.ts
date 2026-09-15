import { getRuntimeErrorI18nKey } from '@lobechat/model-runtime/errors';
import type { ChatMessageError, ErrorResponse, ErrorType } from '@lobechat/types';
import { isRecord, pickTrimmedString } from '@lobechat/utils';
import i18next, { t } from 'i18next';
import { getProviderDisplayName } from 'model-bank/modelProviders';

/**
 * Runtime error codes live in their own `modelRuntime` namespace while HTTP
 * statuses and app-only codes stay under the legacy `error:response.<X>` map;
 * `getRuntimeErrorI18nKey` owns that routing (and alias canonicalisation).
 * Looking a runtime code up in the wrong place makes i18next echo the key back,
 * which is how users ended up seeing raw `response.InvalidProviderAPIKey` text
 * in the "fetch model list" toast.
 */
const translateErrorType = (errorType: ErrorResponse['errorType'], body: unknown) => {
  const { key, ns } = getRuntimeErrorI18nKey(errorType);

  // Both namespaces interpolate `{{provider}}`; the backend puts the provider
  // **id** on the error body, so resolve it to the display name the same way
  // `useProviderName` does — otherwise the toast reads "meta" instead of "Meta".
  const providerId = isRecord(body) ? pickTrimmedString(body.provider) : undefined;
  const provider = providerId ? getProviderDisplayName(providerId) : '';

  // A registered code with no locale entry yet (e.g. `NoAvailableProvider`) must
  // not surface as the bare code: prefer the backend's own message, then the
  // generic fetch-error copy, mirroring the connection checker's fallback chain.
  const defaultValue =
    (isRecord(body) ? pickTrimmedString(body.message) : pickTrimmedString(body)) ??
    t('response.UnknownChatFetchError', { ns: 'error' });

  return t(key, { defaultValue, ns, provider });
};

/**
 * Namespaces are lazy-loaded per route, and this runs outside React so no
 * `useTranslation` has pulled them in. Without an explicit load, `t` echoes the
 * key back and the UI shows a raw error code.
 */
const ensureNamespaces = async () => {
  try {
    await i18next.loadNamespaces(['error', 'modelRuntime']);
  } catch {
    // a failed namespace load must not swallow the error we came here to report
  }
};

export const getMessageError = async (response: Response): Promise<ChatMessageError> => {
  let chatMessageError: ChatMessageError;

  await ensureNamespaces();

  // try to get the biz error
  try {
    const data = (await response.json()) as ErrorResponse;
    chatMessageError = {
      body: data.body,
      message: translateErrorType(data.errorType, data.body),
      type: data.errorType,
    };
  } catch {
    // if not return, then it's a common error
    chatMessageError = {
      message: t(`response.${response.status}`, { ns: 'error' }),
      type: response.status as ErrorType,
    };
  }

  return chatMessageError;
};
