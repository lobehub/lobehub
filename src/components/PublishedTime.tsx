'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import { type CSSProperties, type FC } from 'react';
import { useTranslation } from 'react-i18next';

const LAST_MODIFIED = new Date().toISOString();

const formatTime = (time?: string) => {
  try {
    if (!time) return LAST_MODIFIED;
    return dayjs(time).toISOString();
  } catch {
    return LAST_MODIFIED;
  }
};

const formatDate = (date: string, t: (key: string) => string, template?: string) => {
  if (template) return dayjs(date).format(template);
  const d = dayjs(date);
  const now = dayjs();

  if (d.isSame(now, 'day')) return t('time.today');
  if (d.isSame(now.subtract(1, 'day'), 'day')) return t('time.yesterday');
  if (d.isSame(now, 'year')) return d.format(t('time.formatThisYear'));
  return d.format(t('time.formatOtherYear'));
};

const styles = createStaticStyles(({ css }) => {
  return {
    time: css`
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
      letter-spacing: 0.02em;
    `,
  };
});

interface PublishedTimeProps {
  className?: string;
  date: string;
  style?: CSSProperties;
  template?: string;
}
const PublishedTime: FC<PublishedTimeProps> = ({ date, style, className, template }) => {
  const { t } = useTranslation('discover');
  const time = formatDate(date, t as (key: string) => string, template);

  return (
    <time
      aria-label={'published-date'}
      className={cx(styles.time, className)}
      dateTime={formatTime(date)}
      style={style}
    >
      {time}
    </time>
  );
};

export default PublishedTime;
