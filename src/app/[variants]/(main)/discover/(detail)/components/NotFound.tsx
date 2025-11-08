'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

const NotFound = memo(() => {
  const { t } = useTranslation('error', { keyPrefix: 'notFound' });

  return (
    <Flexbox align="center" height="100%" justify="center" style={{ minHeight: 400 }} width="100%">
      <h2>{t('title')}</h2>
    </Flexbox>
  );
});

export default NotFound;
