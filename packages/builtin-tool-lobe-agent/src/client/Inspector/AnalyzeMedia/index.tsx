'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { AnalyzeMediaParams, AnalyzeMediaState } from '../../../types';

const getArrayLength = (value?: string[]) => (Array.isArray(value) ? value.length : 0);

export const AnalyzeMediaInspector = memo<
  BuiltinInspectorProps<AnalyzeMediaParams, AnalyzeMediaState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const question = args?.question || partialArgs?.question;
  const mediaCount =
    pluginState?.files?.length ??
    getArrayLength(args?.refs || partialArgs?.refs) +
      getArrayLength(args?.urls || partialArgs?.urls);

  if (isArgumentsStreaming && !question) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent.apiName.analyzeMedia')}</span>
      </div>
    );
  }

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      {question ? (
        <Trans
          components={{ question: <span className={highlightTextStyles.primary} /> }}
          i18nKey="builtins.lobe-agent.apiName.analyzeMedia.result"
          ns="plugin"
          values={{ question }}
        />
      ) : (
        <span>{t('builtins.lobe-agent.apiName.analyzeMedia')}</span>
      )}
      {!isArgumentsStreaming && !isLoading && mediaCount > 0 && (
        <Text
          as={'span'}
          color={cssVar.colorTextDescription}
          fontSize={12}
          style={{ marginInlineStart: 6 }}
        >
          · {t('builtins.lobe-agent.apiName.analyzeMedia.mediaCount', { count: mediaCount })}
        </Text>
      )}
    </div>
  );
});

AnalyzeMediaInspector.displayName = 'AnalyzeMediaInspector';

export default AnalyzeMediaInspector;
