import type { TFunction } from 'i18next';

type MessengerT = TFunction<'messenger'>;
export type MessengerTranslationKey = `messenger.${string}` | `verify.${string}`;

const SLACK_INSTALL_ERROR_REASON_KEYS = {
  access_denied: 'messenger.slack.installResult.reasons.accessDenied',
  exchange_failed: 'messenger.slack.installResult.reasons.exchangeFailed',
  invalid_state: 'messenger.slack.installResult.reasons.invalidState',
  missing_app_id: 'messenger.slack.installResult.reasons.missingAppId',
  missing_code_or_state: 'messenger.slack.installResult.reasons.missingCodeOrState',
  missing_tenant: 'messenger.slack.installResult.reasons.missingTenant',
  missing_token: 'messenger.slack.installResult.reasons.missingToken',
  persist_failed: 'messenger.slack.installResult.reasons.persistFailed',
} as const satisfies Record<string, MessengerTranslationKey>;

const DISCORD_INSTALL_ERROR_REASON_KEYS = {
  access_denied: 'messenger.discord.installResult.reasons.accessDenied',
  exchange_failed: 'messenger.discord.installResult.reasons.exchangeFailed',
  invalid_state: 'messenger.discord.installResult.reasons.invalidState',
  missing_app_id: 'messenger.discord.installResult.reasons.missingAppId',
  missing_code_or_state: 'messenger.discord.installResult.reasons.missingCodeOrState',
  missing_tenant: 'messenger.discord.installResult.reasons.missingTenant',
  missing_token: 'messenger.discord.installResult.reasons.missingToken',
  persist_failed: 'messenger.discord.installResult.reasons.persistFailed',
} as const satisfies Record<string, MessengerTranslationKey>;

const getMessengerTranslationKey = (error: unknown): MessengerTranslationKey | undefined => {
  if (!error || typeof error !== 'object' || !('message' in error)) return;

  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return;

  if (message.startsWith('messenger.') || message.startsWith('verify.')) {
    return message as MessengerTranslationKey;
  }
};

/**
 * Toast key for a `queued` push result. The server distinguishes WHY the
 * message had to queue (`reason`); the default key claims "the send window is
 * closed", which is a lie for the quota / partial-failure paths and confused
 * users whose window was visibly open.
 */
export const getMessengerQueuedToast = (
  t: MessengerT,
  platform: string,
  reason?: 'quota_exhausted' | 'send_failed' | 'window_closed',
): string => {
  const key: MessengerTranslationKey =
    reason === 'quota_exhausted'
      ? 'messenger.push.queuedQuotaToast'
      : reason === 'send_failed'
        ? 'messenger.push.queuedRetryToast'
        : 'messenger.push.queuedToast';
  return t(key as any, { platform });
};

export const getMessengerErrorMessage = (
  error: unknown,
  t: MessengerT,
  fallbackKey: MessengerTranslationKey,
): string => {
  const key = getMessengerTranslationKey(error);

  return key ? t(key as any) : t(fallbackKey as any);
};

export const getSlackInstallErrorReason = (t: MessengerT, reason?: string | null) => {
  if (!reason) return t('messenger.slack.installResult.reasons.generic');

  const key =
    SLACK_INSTALL_ERROR_REASON_KEYS[reason as keyof typeof SLACK_INSTALL_ERROR_REASON_KEYS];

  return key ? t(key) : reason;
};

export const getDiscordInstallErrorReason = (t: MessengerT, reason?: string | null) => {
  if (!reason) return t('messenger.discord.installResult.reasons.generic');

  const key =
    DISCORD_INSTALL_ERROR_REASON_KEYS[reason as keyof typeof DISCORD_INSTALL_ERROR_REASON_KEYS];

  return key ? t(key) : reason;
};
