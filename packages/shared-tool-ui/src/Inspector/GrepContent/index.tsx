'use client';

import type { GrepContentState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '../../styles';

interface GrepContentArgs {
  directory?: string;
  path?: string;
  pattern?: string;
}

interface CreateGrepContentInspectorOptions {
  noResultsKey: string;
  translationKey: string;
}

export const createGrepContentInspector = ({
  translationKey,
  noResultsKey,
}: CreateGrepContentInspectorOptions) => {
  const Inspector = memo<BuiltinInspectorProps<GrepContentArgs, GrepContentState>>(
    ({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
      const { t } = useTranslation('plugin');

      const pattern = args?.pattern || partialArgs?.pattern || '';

      if (isArgumentsStreaming) {
        if (!pattern)
          return (
            <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
              <span>{t(translationKey as any)}</span>
            </div>
          );

        return (
          <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
            <span>{t(translationKey as any)}: </span>
            <span className={highlightTextStyles.primary}>{pattern}</span>
          </div>
        );
      }

      const resultCount = pluginState?.totalMatches ?? 0;
      const hasResults = resultCount > 0;

      return (
        <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
          <span>{t(translationKey as any)}: </span>
          {pattern && <span className={highlightTextStyles.primary}>{pattern}</span>}
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
        </div>
      );
    },
  );
  Inspector.displayName = 'GrepContentInspector';
  return Inspector;
};
