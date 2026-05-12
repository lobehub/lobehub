'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CallSubAgentParams, CallSubAgentState } from '../../../types';

export const CallSubAgentInspector = memo<
  BuiltinInspectorProps<CallSubAgentParams, CallSubAgentState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const description = args?.description || partialArgs?.description;

  if (isArgumentsStreaming) {
    if (!description)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-agent.apiName.callSubAgent')}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent.apiName.callSubAgent.loading')}</span>
        <span className={highlightTextStyles.primary}>{description}</span>
      </div>
    );
  }

  if (description) {
    return (
      <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
        <span>
          {isLoading
            ? t('builtins.lobe-agent.apiName.callSubAgent.loading')
            : t('builtins.lobe-agent.apiName.callSubAgent.completed')}
        </span>
        <span className={highlightTextStyles.primary}>{description}</span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root}>
      <span>{t('builtins.lobe-agent.apiName.callSubAgent')}</span>
    </div>
  );
});

CallSubAgentInspector.displayName = 'CallSubAgentInspector';

export default CallSubAgentInspector;
