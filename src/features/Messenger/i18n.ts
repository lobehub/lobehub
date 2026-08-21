import type { TFunction } from 'i18next';

import type { MessengerPushResult } from '@/server/services/messenger/push';

type MessengerT = TFunction<'messenger'>;
/** Why a push had to be queued — kept in sync with the server by derivation. */
type MessengerPushQueueReason = NonNullable<MessengerPushResult['reason']>;
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

const QUEUED_TOAST_KEYS = {
  delivery_in_progress: 'messenger.push.queuedBusyToast',
  quota_exhausted: 'messenger.push.queuedQuotaToast',
  send_failed: 'messenger.push.queuedRetryToast',
  window_closed: 'messenger.push.queuedToast',
} as const satisfies Record<MessengerPushQueueReason, MessengerTranslationKey>;

/**
 * Toast key for a `queued` push result. The server distinguishes WHY the
 * message had to queue (`reason`); the default key claims "the send window is
 * closed", which is a lie for the quota / partial-failure paths and confused
 * users whose window was visibly open.
 *
 * `reason` is optional because a platform without a send window never sets one
 * — those fall back to the plain "window closed" copy.
 */
export const getMessengerQueuedToast = (
  t: MessengerT,
  platform: string,
  reason?: MessengerPushQueueReason,
): string => t(QUEUED_TOAST_KEYS[reason ?? 'window_closed'], { platform });

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
