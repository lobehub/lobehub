import {
  formatActivityTime,
  type FormatActivityTimeOptions,
  type FormattedActivityTime,
} from '@lobechat/utils/time';
import { useTranslation } from 'react-i18next';

export type UseActivityTimeOptions = Omit<
  FormatActivityTimeOptions,
  'formatOtherYear' | 'formatThisYear'
>;

/**
 * Format a timestamp using the activity-feed convention: relative within
 * `relativeThresholdMs` (default 24h), absolute date afterwards. The format
 * strings are pulled from the `common` namespace so callers don't need to
 * wire up i18n themselves.
 */
export const useActivityTime = (
  time?: string | Date | number | null,
  options?: UseActivityTimeOptions,
): FormattedActivityTime => {
  const { t } = useTranslation('common');
  return formatActivityTime(time, {
    ...options,
    formatOtherYear: t('time.formatOtherYear'),
    formatThisYear: t('time.formatThisYear'),
  });
};
