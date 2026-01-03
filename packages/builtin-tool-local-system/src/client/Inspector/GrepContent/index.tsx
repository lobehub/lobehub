'use client';

import { type GrepContentParams } from '@lobechat/electron-client-ipc';
import { type BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import { type GrepContentState } from '../../..';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
}));

export const GrepContentInspector = memo<
  BuiltinInspectorProps<GrepContentParams, GrepContentState>
>(({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
  const { t } = useTranslation('plugin');

  const pattern = args?.pattern || partialArgs?.pattern || '';

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!pattern)
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.apiName.grepContent')}</span>
        </div>
      );

    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.apiName.grepContent')}: </span>
        <span className={highlightTextStyles.primary}>{pattern}</span>
      </div>
    );
  }

  // Check result count
  const resultCount = pluginState?.result?.total_matches ?? 0;
  const hasResults = resultCount > 0;

  return (
    <div className={cx(styles.root, isLoading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-local-system.apiName.grepContent')}: </span>
      {pattern && <span className={highlightTextStyles.primary}>{pattern}</span>}
      {!isLoading &&
        pluginState?.result &&
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
    </div>
  );
});

GrepContentInspector.displayName = 'GrepContentInspector';
