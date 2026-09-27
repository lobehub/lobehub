'use client';

import type { BuiltinInspectorProps, SearchQuery, UniformSearchResponse } from '@lobechat/types';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

export const SearchInspector = memo<BuiltinInspectorProps<SearchQuery, UniformSearchResponse>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const query = args?.query || partialArgs?.query || '';
    // The read path drops the hit list and pins its size as `resultCount`; the
    // array is only here for a payload stored before that.
    const resultCount = pluginState?.resultCount ?? pluginState?.results?.length ?? 0;
    const hasResults = resultCount > 0;
    const hasSettled = !!pluginState?.results || typeof pluginState?.resultCount === 'number';

    if (isArgumentsStreaming && !query) {
      return (
        <div className={inspectorTextStyles.root}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-web-browsing.apiName.search')}
          </span>
        </div>
      );
    }

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {t('builtins.lobe-web-browsing.apiName.search')}:{'\u00A0'}
        </span>
        {query && <span className={highlightTextStyles.primary}>{query}</span>}
        {!isLoading &&
          !isArgumentsStreaming &&
          hasSettled &&
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
