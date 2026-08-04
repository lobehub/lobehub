'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import CountStepper from '../components/CountStepper';
import SettingRow from '../components/SettingRow';
import { HOME_COUNT_MAX, HOME_COUNT_MIN } from '../config';

export interface RecentsTabProps {
  recentsCount: number;
  setRecentsCount: (value: number) => void;
}

const RecentsTab = memo<RecentsTabProps>(({ recentsCount, setRecentsCount }) => {
  const { t } = useTranslation('home');

  return (
    <Flexbox gap={20}>
      <Flexbox gap={4}>
        <Text as={'h2'} fontSize={16} weight={600}>
          {t('dashboard.customize.tab.recents')}
        </Text>
        <Text type={'secondary'}>{t('dashboard.customize.recents.desc')}</Text>
      </Flexbox>
      <SettingRow
        description={t('dashboard.customize.recents.count.desc')}
        title={t('dashboard.customize.recents.count.title')}
      >
        <CountStepper
          max={HOME_COUNT_MAX}
          min={HOME_COUNT_MIN}
          value={recentsCount}
          onChange={setRecentsCount}
        />
      </SettingRow>
    </Flexbox>
  );
});

export default RecentsTab;
