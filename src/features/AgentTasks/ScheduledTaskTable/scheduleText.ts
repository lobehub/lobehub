import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import { normalizeDayjsLocale } from '@/utils/dayjsLocale';

dayjs.extend(relativeTime);

type TimeValue = Date | string;

const localized = (time: TimeValue, locale: string) =>
  dayjs(time).locale(normalizeDayjsLocale(locale));

interface FormatRunMomentOptions {
  /** dayjs format for a moment on another day, e.g. `MMM D HH:mm`. */
  dateTimeFormat: string;
  locale: string;
  now: Date;
}

/**
 * A run's moment as a clock reading: the time alone when it falls on today
 * (the viewer's day), date and time otherwise.
 */
export const formatRunMoment = (
  time: TimeValue,
  { dateTimeFormat, locale, now }: FormatRunMomentOptions,
): string => {
  const moment = localized(time, locale);
  return moment.format(moment.isSame(dayjs(now), 'day') ? 'HH:mm' : dateTimeFormat);
};

/** "in 2 hours" / "3 days ago", measured from `now`. */
export const formatRelativeToNow = (time: TimeValue, now: Date, locale: string): string =>
  localized(time, locale).from(dayjs(now));

/** "12 minutes" / "2 months": how long ago `since` was, without a suffix. */
export const formatElapsed = (since: TimeValue, now: Date, locale: string): string =>
  localized(since, locale).from(dayjs(now), true);
