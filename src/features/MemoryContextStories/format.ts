import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatAgo } from '@/features/MemoryEntities/format';

type DateLike = Date | string;

/** Dates and ages for story cards and pages, in the user's language. */
export const useStoryFormat = () => {
  const { i18n, t } = useTranslation('memory');
  const locale = i18n.language;

  return useMemo(() => {
    const yearMonth = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' });
    const monthDay = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    const full = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const thisYear = new Date().getFullYear();

    return {
      ago: (date: DateLike) => formatAgo(new Date(date).toISOString(), locale),
      /** Day of a record: month and day this year, with the year otherwise. */
      day: (date: DateLike) => {
        const d = new Date(date);
        return d.getFullYear() === thisYear ? monthDay.format(d) : full.format(d);
      },
      /** "May 2025 → now" for ongoing stories, "May 2025 → Aug 2025" otherwise. */
      span: (from: DateLike | null, to: DateLike | null, ongoing: boolean) => {
        if (!from && !to) return undefined;
        const start = yearMonth.format(new Date((from ?? to)!));
        const end = ongoing ? t('story.span.now') : yearMonth.format(new Date((to ?? from)!));
        return start === end ? start : `${start} → ${end}`;
      },
      t,
    };
  }, [locale, t]);
};

export type StoryFormat = ReturnType<typeof useStoryFormat>;
