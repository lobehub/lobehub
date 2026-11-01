import dayjs from 'dayjs';

import { normalizeDayjsLocale } from '@/utils/dayjsLocale';

export const formatNotificationRelativeTime = (
  createdAt: Date | string,
  locale?: string,
): string => {
  const date = dayjs(createdAt);

  if (!date.isValid()) return '';

  return locale ? date.locale(normalizeDayjsLocale(locale)).fromNow() : date.fromNow();
};
