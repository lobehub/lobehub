'use client';

import { type BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import { type SearchKnowledgeBaseArgs, type SearchKnowledgeBaseState } from '../../..';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
}));

export const SearchKnowledgeBaseInspector = memo<
  BuiltinInspectorProps<SearchKnowledgeBaseArgs, SearchKnowledgeBaseState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const query = args?.query || partialArgs?.query || '';
  // Use fileResults length for display (aggregated by file)
  const resultCount = pluginState?.fileResults?.length ?? 0;
  const hasResults = resultCount > 0;

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!query)
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-knowledge-base.apiName.searchKnowledgeBase')}</span>
        </div>
      );

    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-knowledge-base.apiName.searchKnowledgeBase')}: </span>
        <span className={highlightTextStyles.gold}>{query}</span>
      </div>
    );
  }

  return (
    <div className={cx(styles.root, isLoading && shinyTextStyles.shinyText)}>
      <span style={{ marginInlineStart: 2 }}>
        <span>{t('builtins.lobe-knowledge-base.apiName.searchKnowledgeBase')}: </span>
        {query && <span className={highlightTextStyles.gold}>{query}</span>}
        {!isLoading &&
          pluginState?.fileResults &&
          (hasResults ? (
            <span style={{ marginInlineStart: 4 }}>({resultCount})</span>
          ) : (
            <Text
              as={'span'}
              color={cssVar.colorTextDescription}
              fontSize={12}
              style={{ marginInlineStart: 4 }}
            >
              ({t('builtins.lobe-knowledge-base.inspector.noResults')})
            </Text>
          ))}
      </span>
    </div>
  );
});

SearchKnowledgeBaseInspector.displayName = 'SearchKnowledgeBaseInspector';
