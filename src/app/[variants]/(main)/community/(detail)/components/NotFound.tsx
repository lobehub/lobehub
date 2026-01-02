'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const NotFound = memo(() => {
  const { t } = useTranslation('error');

  return (
    <Flexbox align="center" height="100%" justify="center" style={{ minHeight: 400 }} width="100%">
      <h2>{t('notFound.title')}</h2>
    </Flexbox>
  );
});

export default NotFound;
