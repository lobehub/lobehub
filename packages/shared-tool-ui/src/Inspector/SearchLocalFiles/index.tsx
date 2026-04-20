'use client';

import type { SearchFilesState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '../../styles';

interface SearchFilesArgs {
  keyword?: string;
  keywords?: string;
  query?: string;
}

interface CreateSearchLocalFilesInspectorOptions {
  noResultsKey: string;
  translationKey: string;
}

export const createSearchLocalFilesInspector = ({
  translationKey,
  noResultsKey,
}: CreateSearchLocalFilesInspectorOptions) => {
  const Inspector = memo<BuiltinInspectorProps<SearchFilesArgs, SearchFilesState>>(
    ({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
      const { t } = useTranslation('plugin');

      // Support all keyword field variants
      const query =
        args?.keyword ||
        args?.keywords ||
        args?.query ||
        partialArgs?.keyword ||
        partialArgs?.keywords ||
        partialArgs?.query ||
        '';

      if (isArgumentsStreaming) {
        if (!query)
          return (
            <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
              <span>{t(translationKey as any)}</span>
            </div>
          );

        return (
          <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
            <span>{t(translationKey as any)}: </span>
            <span className={highlightTextStyles.primary}>{query}</span>
          </div>
        );
      }

      const resultCount = pluginState?.results?.length ?? pluginState?.totalCount ?? 0;
      const hasResults = resultCount > 0;

      return (
        <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
          <span style={{ marginInlineStart: 2 }}>
            <span>{t(translationKey as any)}: </span>
            {query && <span className={highlightTextStyles.primary}>{query}</span>}
            {!isLoading &&
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
                  ({t(noResultsKey as any)})
                </Text>
              ))}
          </span>
        </div>
      );
    },
  );
  Inspector.displayName = 'SearchLocalFilesInspector';
  return Inspector;
};
