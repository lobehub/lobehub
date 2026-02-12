'use client';

import 'dayjs/locale/zh.js';

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

const styles = createStaticStyles(({ css }) => {
  return {
    time: css`
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
      letter-spacing: 0.02em;
    `,
  };
});

interface PrivacyUpdatedProps {
  className?: string;
  date: string;
  showPrefix?: boolean;
  style?: CSSProperties;
  template?: string;
}
const PublishedTime: FC<PrivacyUpdatedProps> = ({
  date,
  style,
  className,
  template = 'dddd, MMMM D YYYY',
  showPrefix = true,
}) => {
  const { t, i18n } = useTranslation('discover');
  const time = dayjs(date).locale(i18n.language).format(template);

  if (showPrefix) {
    return (
      <div className={cx(styles.time, className)} style={style}>
        {t('publishedTime')}{' '}
        <time aria-label={'published-date'} dateTime={formatTime(date)}>
          {time}
        </time>
      </div>
    );
  } else {
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
  }
};

export default PublishedTime;
