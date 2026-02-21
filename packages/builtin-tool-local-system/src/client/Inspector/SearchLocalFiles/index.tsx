'use client';

import type { LocalSearchFilesParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { LocalFileSearchState } from '../../..';

export const SearchLocalFilesInspector = memo<
  BuiltinInspectorProps<LocalSearchFilesParams, LocalFileSearchState>
>(({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
  const { t } = useTranslation('plugin');

  const keywords = args?.keywords || partialArgs?.keywords || '';

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!keywords)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.apiName.searchLocalFiles')}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.apiName.searchLocalFiles')}: </span>
        <span className={highlightTextStyles.primary}>{keywords}</span>
      </div>
    );
  }

  // Check if search returned results
  const resultCount = pluginState?.searchResults?.length ?? 0;
  const hasResults = resultCount > 0;
  const engine = pluginState?.engine;

  return (
    <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
      <span style={{ marginInlineStart: 2 }}>
        <span>{t('builtins.lobe-local-system.apiName.searchLocalFiles')}: </span>
        {keywords && <span className={highlightTextStyles.primary}>{keywords}</span>}
        {!isLoading &&
          pluginState?.searchResults &&
          (hasResults ? (
            <span style={{ marginInlineStart: 4 }}>({resultCount})</span>
          ) : (
            <Text
              as={'span'}
              color={cssVar.colorTextDescription}
              fontSize={12}
              style={{ marginInlineStart: 4 }}
            >
              ({t('builtins.lobe-local-system.inspector.noResults')})
            </Text>
          ))}
        {!isLoading && engine && (
          <Text
            as={'span'}
            color={cssVar.colorTextDescription}
            fontSize={12}
            style={{ marginInlineStart: 4 }}
          >
            [{engine}]
          </Text>
        )}
      </span>
    </div>
  );
});

SearchLocalFilesInspector.displayName = 'SearchLocalFilesInspector';
