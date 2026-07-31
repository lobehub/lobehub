'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { LoaderCircle, Target } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreateGoalParams, CreateGoalState } from '../../../types';
import { TaskResultCard } from '../shared';

const formatElapsed = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
};

const CreateGoalRender = memo<BuiltinRenderProps<CreateGoalParams, CreateGoalState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('plugin');
    const identifier = pluginState?.identifier;
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
      const timer = window.setInterval(() => setNow(Date.now()), 1000);
      return () => window.clearInterval(timer);
    }, []);

    if (!pluginState?.success || !identifier) return null;

    return (
      <TaskResultCard
        icon={Target}
        iconColor={cssVar.colorTextSecondary}
        identifier={identifier}
        title={pluginState.name ?? args?.name}
      >
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon spin color={cssVar.colorInfo} icon={LoaderCircle} size={15} />
          <Flexbox flex={1} gap={2}>
            <Flexbox horizontal align={'center'} justify={'space-between'}>
              <Text fontSize={13}>{t('builtins.lobe-task.goal.running')}</Text>
              <Text code fontSize={12} type={'secondary'}>
                {formatElapsed(now - new Date(pluginState.startedAt ?? Date.now()).getTime())}
              </Text>
            </Flexbox>
            <Text fontSize={12} type={'secondary'}>
              {t('builtins.lobe-task.goal.runningHint', { count: args?.criteria?.length ?? 0 })}
            </Text>
          </Flexbox>
        </Flexbox>
      </TaskResultCard>
    );
  },
);

CreateGoalRender.displayName = 'CreateGoalRender';

export default CreateGoalRender;
