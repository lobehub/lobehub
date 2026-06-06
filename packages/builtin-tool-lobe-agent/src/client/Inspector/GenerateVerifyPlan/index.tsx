'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { GenerateVerifyPlanParams, GenerateVerifyPlanState } from '../../../types';

export const GenerateVerifyPlanInspector = memo<
  BuiltinInspectorProps<GenerateVerifyPlanParams, GenerateVerifyPlanState>
>(({ args, partialArgs, pluginState, isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  const title = pluginState?.title || args?.title || partialArgs?.title;

  if (isArgumentsStreaming && !title) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent.apiName.generateVerifyPlan')}</span>
      </div>
    );
  }

  return (
    <div
      className={cx(inspectorTextStyles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
    >
      {title ? (
        <Trans
          components={{ title: <span className={highlightTextStyles.primary} /> }}
          i18nKey="builtins.lobe-agent.apiName.generateVerifyPlan.result"
          ns="plugin"
          values={{ title }}
        />
      ) : (
        <span>{t('builtins.lobe-agent.apiName.generateVerifyPlan')}</span>
      )}
    </div>
  );
});

GenerateVerifyPlanInspector.displayName = 'GenerateVerifyPlanInspector';

export default GenerateVerifyPlanInspector;
