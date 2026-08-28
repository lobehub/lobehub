'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CreateGoalParams, CreateGoalState } from '../../../types';

const CreateGoalInspector = memo<BuiltinInspectorProps<CreateGoalParams, CreateGoalState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');
    const name = args?.name || partialArgs?.name || pluginState?.name;

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{t('builtins.lobe-goal.apiName.createGoal')}</span>
        {name && <span> · {name}</span>}
      </div>
    );
  },
);

CreateGoalInspector.displayName = 'CreateGoalInspector';

export default CreateGoalInspector;
