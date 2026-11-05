'use client';

import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const Title = memo(() => {
  const { t } = useTranslation('chat');

  return <Text type={'secondary'}>{t('miniGame.sceneName')}</Text>;
});

Title.displayName = 'MiniGamePortalTitle';

export default Title;
