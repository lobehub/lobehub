import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { normalizeAsyncError } from '@/libs/swr/normalizeError';

export interface SaveToastOptions {
  /**
   * Suppress the server-supplied cause. Only for failures whose raw message is
   * an implementation detail the user can do nothing with.
   */
  hideCause?: boolean;
  /**
   * Retry handler. A Retry action is shown only when the failure is retryable —
   * `normalizeAsyncError` marks auth / permission failures (401 / 403, or an
   * explicit `meta.shouldRetry === false`) non-retryable, so we never dangle a
   * pointless Retry on a wall the user can't get through.
   */
  retry?: () => void;
  /** Override the default "Failed to save your changes" title. */
  title?: string;
}

/**
 * Standard failure toast for write actions — the write-side counterpart to the
 * read-side `AsyncError`. Works inside zustand class actions (uses the imperative
 * base-ui `toast` + i18next `t`, no React context). Pass it as `runMutation`'s
 * `onError` so every migrated mutation surfaces failures the same way.
 *
 * The title says what failed, the description says why: a payment declined for a
 * specific reason is only actionable if that reason survives to the user, so the
 * normalized `rawMessage` is shown unless a call site opts out.
 */
export const saveToast = (error: unknown, options: SaveToastOptions = {}) => {
  const { hideCause, retry, title } = options;
  const { rawMessage, retryable } = normalizeAsyncError(error);
  const resolvedTitle = title ?? t('saveState.saveFailed', { ns: 'error' });
  const cause = hideCause || rawMessage === resolvedTitle ? undefined : rawMessage;

  return toast.error({
    actions:
      retry && retryable
        ? [{ label: t('saveState.retry', { ns: 'error' }), onClick: retry, variant: 'primary' }]
        : undefined,
    description: cause,
    title: resolvedTitle,
  });
};
