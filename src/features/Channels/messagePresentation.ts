import type { ChannelPublicMessage } from '@lobechat/types';

import type { TimelineItem } from './joinEvents';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

const itemDate = (item: TimelineItem) =>
  new Date(item.kind === 'event' ? item.event.at : item.message.createdAt);

const sameAuthor = (a: ChannelPublicMessage, b: ChannelPublicMessage) =>
  !!a.author.id && a.author.id === b.author.id && a.author.type === b.author.type;

/** Group only adjacent speech; system events, dates and reply contexts break a group. */
export const presentChannelTimeline = (items: TimelineItem[]) =>
  items.map((item, index) => {
    const previous = items[index - 1];
    const date = itemDate(item);
    const previousDate = previous && itemDate(previous);
    const startsDay = !previousDate || date.toDateString() !== previousDate.toDateString();
    const elapsed = previousDate ? date.getTime() - previousDate.getTime() : Infinity;
    const continuation =
      !startsDay &&
      elapsed >= 0 &&
      elapsed <= GROUP_WINDOW_MS &&
      item.kind === 'message' &&
      previous?.kind === 'message' &&
      sameAuthor(item.message, previous.message) &&
      item.message.threadId === previous.message.threadId &&
      item.message.replyToId === previous.message.replyToId;

    return { continuation, date, item, startsDay };
  });

/** Stable clock labels keep the feed scannable and do not depend on dayjs's global locale. */
export const channelTimeFormatters = (locale: string) => ({
  date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }),
  full: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'medium' }),
  time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `date` to `now`, in local time, unaffected by daylight-saving shifts. */
const calendarDaysAgo = (date: Date, now: Date) =>
  Math.round(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) /
      DAY_MS,
  );

/**
 * A day divider's label, the way WeChat stamps a conversation: the time alone today, then
 * "Yesterday", the weekday within the past week, the month and day within this year, or the full
 * date before that, each followed by the time of the day's first message.
 */
export const channelDayLabel = (
  date: Date,
  {
    locale,
    now = new Date(),
    yesterday,
  }: {
    locale: string;
    now?: Date;
    yesterday: string;
  },
) => {
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  const days = calendarDaysAgo(date, now);
  if (days === 0) return time;
  const day =
    days === 1
      ? yesterday
      : days > 1 && days < 7
        ? new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date)
        : date.getFullYear() === now.getFullYear()
          ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(date)
          : new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date);
  return `${day} ${time}`;
};
