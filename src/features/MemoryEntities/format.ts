import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { hasStatusLabel } from './kinds';
import { type ContextKind } from './types';

const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

export const daysFromToday = (iso: string, now = new Date()) =>
  Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(now).getTime()) / DAY);

/** Rough age for list rows: today, yesterday, N days / months / years ago. */
export const formatAgo = (iso: string, locale: string, now = new Date()) => {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const days = daysFromToday(iso, now);
  if (days > -30) return rtf.format(Math.min(days, 0), 'day');
  if (days > -365) return rtf.format(Math.round(days / 30), 'month');
  return rtf.format(Math.round(days / 365), 'year');
};

/** Dates, ages and labels in the user's language. */
export const useEntityFormat = () => {
  const { i18n, t } = useTranslation('memory');
  const locale = i18n.language;

  return useMemo(() => {
    const monthDay = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    const day = new Intl.DateTimeFormat(locale, { day: 'numeric' });
    const month = new Intl.DateTimeFormat(locale, { month: 'long' });
    const yearMonth = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
    const names = new Intl.ListFormat(locale, { style: 'narrow', type: 'unit' });

    return {
      ago: (iso: string) => formatAgo(iso, locale),
      day: (iso: string) => day.format(new Date(iso)),
      kind: (kind: ContextKind) => t(`entity.kind.${kind}`),
      kindExample: (kind: ContextKind) => t(`entity.kind.${kind}.example`),
      month: (iso: string) => {
        const date = new Date(iso);
        return date.getFullYear() === new Date().getFullYear()
          ? month.format(date)
          : yearMonth.format(date);
      },
      monthDay: (iso: string) => monthDay.format(new Date(iso)),
      names: (list: string[]) => names.format(list),
      /** Backend status in words; values outside the known enum are shown as written. */
      status: (value?: string): string | undefined => {
        if (!value) return undefined;
        return hasStatusLabel(value) ? t(`entity.status.${value}`) : value;
      },
      t,
      title: (entity: { title: string }) => entity.title || t('entity.untitled'),
      weekday: (iso: string) => weekday.format(new Date(iso)),
    };
  }, [locale, t]);
};

export type EntityFormat = ReturnType<typeof useEntityFormat>;
