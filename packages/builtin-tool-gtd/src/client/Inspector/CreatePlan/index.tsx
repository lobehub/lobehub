'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CreatePlanParams, CreatePlanState } from '../../../types';

export const CreatePlanInspector = memo<BuiltinInspectorProps<CreatePlanParams, CreatePlanState>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const goal = args?.goal || partialArgs?.goal;

    if (isArgumentsStreaming && !goal) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-gtd.apiName.createPlan')}</span>
        </div>
      );
    }

    return (
      <div
        className={cx(inspectorTextStyles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
      >
        {goal ? (
          <Trans
            components={{ goal: <span className={highlightTextStyles.primary} /> }}
            i18nKey="builtins.lobe-gtd.apiName.createPlan.result"
            ns="plugin"
            values={{ goal }}
          />
        ) : (
          <span>{t('builtins.lobe-gtd.apiName.createPlan')}</span>
        )}
      </div>
    );
  },
);

CreatePlanInspector.displayName = 'CreatePlanInspector';

export default CreatePlanInspector;
