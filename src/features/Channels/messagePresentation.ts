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
 * A message's header time, the way Discord stamps it: the time alone today (the day divider above
 * names the date), "Yesterday" with the time, and the numeric date with the time before that, so a
 * message read away from its divider still says which day it was sent.
 */
export const channelMessageTime = (
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
      : new Intl.DateTimeFormat(locale, {
          day: 'numeric',
          month: 'numeric',
          year: 'numeric',
        }).format(date);
  return `${day} ${time}`;
};
