'use client';

import type { BuiltinInspectorProps, SearchQuery, UniformSearchResponse } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

export const SearchInspector = memo<BuiltinInspectorProps<SearchQuery, UniformSearchResponse>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const query = args?.query || partialArgs?.query || '';
    const resultCount = pluginState?.results?.length ?? 0;
    const hasResults = resultCount > 0;

    if (isArgumentsStreaming && !query) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-web-browsing.apiName.search')}</span>
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
        <span>{t('builtins.lobe-web-browsing.apiName.search')}: </span>
        {query && <span className={highlightTextStyles.primary}>{query}</span>}
        {!isLoading &&
          !isArgumentsStreaming &&
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
              ({t('builtins.lobe-web-browsing.inspector.noResults')})
            </Text>
          ))}
      </div>
    );
  },
);

SearchInspector.displayName = 'SearchInspector';

export default SearchInspector;
