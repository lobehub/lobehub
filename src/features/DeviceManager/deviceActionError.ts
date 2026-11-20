import { t } from 'i18next';

/**
 * Server refusal raised by `assertDeviceNotBoundToFixedAgent` when a workspace
 * device that a workspace agent pins as its fixed run device would be hidden
 * (made private) or removed.
 */
export const DEVICE_BOUND_TO_FIXED_AGENT = 'DeviceBoundToFixedAgent';

/**
 * Toast copy for a failed device-management mutation (publish / make private /
 * remove / share). Known refusals map to localized, actionable copy; other
 * server messages are user-facing and shown verbatim, with a generic fallback
 * when the error carries none (e.g. a network failure without a message).
 */
export const getDeviceActionErrorMessage = (error: unknown): string => {
  const data = (error as { data?: { errorData?: { code?: unknown } } } | null)?.data;
  if (data?.errorData?.code === DEVICE_BOUND_TO_FIXED_AGENT)
    return t('devices.errors.boundToFixedAgent', { ns: 'setting' });

  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.trim()) return message;

  return t('operationFailed', { ns: 'common' });
};
