import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { normalizeAsyncError } from '@/libs/swr/normalizeError';

export interface SaveToastOptions {
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
 */
export const saveToast = (error: unknown, options: SaveToastOptions = {}) => {
  const { retry, title } = options;
  const { retryable } = normalizeAsyncError(error);

  return toast.error({
    actions:
      retry && retryable
        ? [{ label: t('saveState.retry', { ns: 'error' }), onClick: retry, variant: 'primary' }]
        : undefined,
    title: title ?? t('saveState.saveFailed', { ns: 'error' }),
  });
};
