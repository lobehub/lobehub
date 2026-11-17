'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cssVar, cx, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { SearchKnowledgeBaseArgs, SearchKnowledgeBaseState } from '../../..';

export const SearchKnowledgeBaseInspector = memo<
  BuiltinInspectorProps<SearchKnowledgeBaseArgs, SearchKnowledgeBaseState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const query = args?.query || partialArgs?.query || '';
  // Count what the card lists: file hits (aggregated by file) plus keyword hits.
  // The read path drops the hit lists and pins the size as `resultCount`; the
  // arrays are only here for a payload stored before that.
  const resultCount =
    pluginState?.resultCount ??
    (pluginState?.fileResults?.length ?? 0) + (pluginState?.documents?.length ?? 0);
  const hasSettled = !!pluginState?.fileResults || typeof pluginState?.resultCount === 'number';
  const hasResults = resultCount > 0;
  // Nothing was searched — no library in scope, or none of its files indexed —
  // which is not the same as 0 hits.
  const emptyLabelKey =
    pluginState?.scope === 'none'
      ? 'builtins.lobe-knowledge-base.inspector.noScope'
      : pluginState?.status === 'not_indexed'
        ? 'builtins.lobe-knowledge-base.inspector.notIndexed'
        : 'builtins.lobe-knowledge-base.inspector.noResults';

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!query)
      return (
        <div className={inspectorTextStyles.root}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-knowledge-base.apiName.searchKnowledgeBase')}
          </span>
        </div>
      );

    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-knowledge-base.apiName.searchKnowledgeBase')}:{' '}
        </span>
        <span className={highlightTextStyles.gold}>{query}</span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root}>
      <span style={{ marginInlineStart: 2 }}>
        <span className={cx(isLoading && shinyTextStyles.shinyText)}>
          {t('builtins.lobe-knowledge-base.apiName.searchKnowledgeBase')}:{' '}
        </span>
        {query && <span className={highlightTextStyles.gold}>{query}</span>}
        {!isLoading &&
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
              ({t(emptyLabelKey)})
            </Text>
          ))}
      </span>
    </div>
  );
});

SearchKnowledgeBaseInspector.displayName = 'SearchKnowledgeBaseInspector';
