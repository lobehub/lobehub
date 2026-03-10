'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { SearchMemoryParams, SearchUserMemoryState } from '../../../types';

export const SearchUserMemoryInspector = memo<
  BuiltinInspectorProps<SearchMemoryParams, SearchUserMemoryState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const query = args?.query || partialArgs?.query;

  // Initial streaming state
  if (isArgumentsStreaming && !query) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-user-memory.apiName.searchUserMemory')}</span>
      </div>
    );
  }

  // pluginState is SearchMemoryResult directly (activities, contexts, experiences, preferences)
  const resultCount = pluginState
    ? (pluginState.activities?.length ?? 0) +
      (pluginState.contexts?.length ?? 0) +
      (pluginState.experiences?.length ?? 0) +
      (pluginState.preferences?.length ?? 0)
    : 0;
  const hasResults = resultCount > 0;

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-user-memory.apiName.searchUserMemory')}: </span>
      {query && <span className={highlightTextStyles.primary}>{query}</span>}
      {!isLoading &&
        !isArgumentsStreaming &&
        pluginState &&
        (hasResults ? (
          <span style={{ marginInlineStart: 4 }}>({resultCount})</span>
        ) : (
          <Text
            as={'span'}
            color={cssVar.colorTextDescription}
            fontSize={12}
            style={{ marginInlineStart: 4 }}
          >
            ({t('builtins.lobe-user-memory.inspector.noResults')})
          </Text>
        ))}
    </div>
  );
});

SearchUserMemoryInspector.displayName = 'SearchUserMemoryInspector';

export default SearchUserMemoryInspector;
