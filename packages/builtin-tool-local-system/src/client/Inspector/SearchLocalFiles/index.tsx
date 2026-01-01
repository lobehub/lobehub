'use client';

import { type LocalSearchFilesParams } from '@lobechat/electron-client-ipc';
import { type BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import { type LocalFileSearchState } from '../../..';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
}));

export const SearchLocalFilesInspector = memo<
  BuiltinInspectorProps<LocalSearchFilesParams, LocalFileSearchState>
>(({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
  const { t } = useTranslation('plugin');

  const keywords = args?.keywords || partialArgs?.keywords || '';

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!keywords)
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.apiName.searchLocalFiles')}</span>
        </div>
      );

    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.apiName.searchLocalFiles')}: </span>
        <span className={highlightTextStyles.primary}>{keywords}</span>
      </div>
    );
  }

  // Check if search returned results
  const resultCount = pluginState?.searchResults?.length ?? 0;
  const hasResults = resultCount > 0;

  return (
    <div className={cx(styles.root, isLoading && shinyTextStyles.shinyText)}>
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
      </span>
    </div>
  );
});

SearchLocalFilesInspector.displayName = 'SearchLocalFilesInspector';
