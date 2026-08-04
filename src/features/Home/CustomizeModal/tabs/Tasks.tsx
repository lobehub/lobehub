'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import CountStepper from '../components/CountStepper';
import SettingRow from '../components/SettingRow';
import { HOME_COUNT_MAX, HOME_COUNT_MIN } from '../config';

export interface TasksTabProps {
  setTaskCount: (value: number) => void;
  taskCount: number;
}

const TasksTab = memo<TasksTabProps>(({ taskCount, setTaskCount }) => {
  const { t } = useTranslation('home');

  return (
    <Flexbox gap={20}>
      <Flexbox gap={4}>
        <Text as={'h2'} fontSize={16} weight={600}>
          {t('dashboard.customize.tab.tasks')}
        </Text>
        <Text type={'secondary'}>{t('dashboard.customize.tasks.desc')}</Text>
      </Flexbox>
      <SettingRow
        description={t('dashboard.customize.tasks.count.desc')}
        title={t('dashboard.customize.tasks.count.title')}
      >
        <CountStepper
          max={HOME_COUNT_MAX}
          min={HOME_COUNT_MIN}
          value={taskCount}
          onChange={setTaskCount}
        />
      </SettingRow>
    </Flexbox>
  );
});

export default TasksTab;
