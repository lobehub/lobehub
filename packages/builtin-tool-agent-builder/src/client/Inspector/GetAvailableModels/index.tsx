'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { GetAvailableModelsParams, GetAvailableModelsState } from '../../../types';

export const GetAvailableModelsInspector = memo<
  BuiltinInspectorProps<GetAvailableModelsParams, GetAvailableModelsState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const providerId = args?.providerId || partialArgs?.providerId;

  // Calculate total model count from providers
  const modelInfo = useMemo(() => {
    if (!pluginState?.providers) return null;

    const allModels = pluginState.providers.flatMap((p) => p.models);
    const totalCount = allModels.length;

    if (totalCount === 0) return null;

    // Get first 2 model names for display
    const displayModels = allModels.slice(0, 2).map((m) => m.name || m.id);
    return { displayModels, totalCount };
  }, [pluginState?.providers]);

  // Initial streaming state
  if (isArgumentsStreaming || isLoading) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-builder.apiName.getAvailableModels')}</span>
        {providerId && (
          <>
            : <span className={highlightTextStyles.primary}>{providerId}</span>
          </>
        )}
      </div>
    );
  }

  // Loaded state with results
  return (
    <div className={inspectorTextStyles.root}>
      <span>{t('builtins.lobe-agent-builder.apiName.getAvailableModels')}: </span>
      {modelInfo && (
        <span className={highlightTextStyles.primary}>
          {modelInfo.displayModels.join(' / ')}
          {modelInfo.totalCount > 2 &&
            t('builtins.lobe-agent-builder.inspector.modelsCount', {
              count: modelInfo.totalCount,
            })}
        </span>
      )}
    </div>
  );
});

GetAvailableModelsInspector.displayName = 'GetAvailableModelsInspector';

export default GetAvailableModelsInspector;
