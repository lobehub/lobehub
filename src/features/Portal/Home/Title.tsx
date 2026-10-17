'use client';

import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const Title = memo(() => {
  const { t } = useTranslation('portal');

  return (
    <Text style={{ fontSize: 16 }} type={'secondary'}>
      {t('title')}
    </Text>
  );
});

export default Title;
