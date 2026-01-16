'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { SearchMarketToolsParams, SearchMarketToolsState } from '../../../types';

export const SearchMarketToolsInspector = memo<
  BuiltinInspectorProps<SearchMarketToolsParams, SearchMarketToolsState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const query = args?.query || partialArgs?.query;
  const category = args?.category || partialArgs?.category;
  const displayText = query || category;

  // Initial streaming state
  if (isArgumentsStreaming && !displayText) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-agent-builder.apiName.searchMarketTools')}</span>
      </div>
    );
  }

  const resultCount = pluginState?.tools?.length ?? 0;
  const hasResults = resultCount > 0;

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-agent-builder.apiName.searchMarketTools')}: </span>
      {displayText && <span className={highlightTextStyles.primary}>{displayText}</span>}
      {!isLoading &&
        !isArgumentsStreaming &&
        pluginState?.tools &&
        (hasResults ? (
          <span style={{ marginInlineStart: 4 }}>({resultCount})</span>
        ) : (
          <Text
            as={'span'}
            color={cssVar.colorTextDescription}
            fontSize={12}
            style={{ marginInlineStart: 4 }}
          >
            ({t('builtins.lobe-agent-builder.inspector.noResults')})
          </Text>
        ))}
    </div>
  );
});

SearchMarketToolsInspector.displayName = 'SearchMarketToolsInspector';

export default SearchMarketToolsInspector;
