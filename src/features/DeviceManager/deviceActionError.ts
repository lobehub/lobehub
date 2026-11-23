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

export interface DeviceShareErrorView {
  /** Raw server message, folded behind "Show details" */
  detail?: string;
  /** One actionable line shown beside the Share button */
  summary: string;
}

/**
 * Inline copy for a failed share in the share dialog. Known refusals keep their
 * localized copy; anything else gets a fixed retry line, with the server message
 * (often English, e.g. a PRECONDITION_FAILED when the device dropped offline)
 * kept as folded detail rather than shown as the summary.
 */
export const getDeviceShareErrorView = (
  error: unknown,
  workspaceName: string,
): DeviceShareErrorView => {
  const data = (error as { data?: { errorData?: { code?: unknown } } } | null)?.data;
  if (data?.errorData?.code === DEVICE_BOUND_TO_FIXED_AGENT)
    return { summary: t('devices.errors.boundToFixedAgent', { ns: 'setting' }) };

  const message = (error as { message?: unknown } | null)?.message;
  return {
    detail: typeof message === 'string' && message.trim() ? message : undefined,
    summary: t('devices.share.failedRetry', { name: workspaceName, ns: 'setting' }),
  };
};
