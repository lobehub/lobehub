import dayjs from 'dayjs';

import { normalizeDayjsLocale } from '@/utils/dayjsLocale';

export interface TaskItemDateFormatOptions {
  formatOtherYear?: string;
  formatThisYear?: string;
  // i18next language code (e.g. "en-US", "zh-CN"); decouples month-name
  // rendering from dayjs's global locale so transient render windows during a
  // language switch don't mix English format strings with Chinese MMM tokens.
  locale?: string;
  now?: Date | string;
}

export const formatTaskItemDate = (
  time?: string | Date | null,
  options: TaskItemDateFormatOptions = {},
) => {
  if (!time) return '';

  const date = dayjs(time);

  if (!date.isValid()) return '';

  const {
    formatOtherYear = 'MMM D, YYYY',
    formatThisYear = 'MMM D',
    locale,
    now = new Date(),
  } = options;
  const current = dayjs(now);
  const localized = locale ? date.locale(normalizeDayjsLocale(locale)) : date;

  return localized.format(date.isSame(current, 'year') ? formatThisYear : formatOtherYear);
};
