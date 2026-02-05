'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { SearchLocalFilesState } from '../../../types';

interface SearchLocalFilesParams {
  path?: string;
  query: string;
}

export const SearchLocalFilesInspector = memo<
  BuiltinInspectorProps<SearchLocalFilesParams, SearchLocalFilesState>
>(({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
  const { t } = useTranslation('plugin');

  const query = args?.query || partialArgs?.query || '';

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!query)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-cloud-sandbox.apiName.searchLocalFiles')}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-cloud-sandbox.apiName.searchLocalFiles')}: </span>
        <span className={highlightTextStyles.primary}>{query}</span>
      </div>
    );
  }

  // Check if search returned results
  const resultCount = pluginState?.results?.length ?? 0;
  const hasResults = resultCount > 0;

  return (
    <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
      <span style={{ marginInlineStart: 2 }}>
        <span>{t('builtins.lobe-cloud-sandbox.apiName.searchLocalFiles')}: </span>
        {query && <span className={highlightTextStyles.primary}>{query}</span>}
        {!isLoading &&
          pluginState?.results &&
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
      </span>
    </div>
  );
});

SearchLocalFilesInspector.displayName = 'SearchLocalFilesInspector';
