'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { GrepContentState } from '../../../types';

interface GrepContentParams {
  include?: string;
  path?: string;
  pattern: string;
}

export const GrepContentInspector = memo<
  BuiltinInspectorProps<GrepContentParams, GrepContentState>
>(({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
  const { t } = useTranslation('plugin');

  const pattern = args?.pattern || partialArgs?.pattern || '';

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!pattern)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-cloud-sandbox.apiName.grepContent')}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-cloud-sandbox.apiName.grepContent')}: </span>
        <span className={highlightTextStyles.primary}>{pattern}</span>
      </div>
    );
  }

  // Check result count
  const resultCount = pluginState?.totalMatches ?? 0;
  const hasResults = resultCount > 0;

  return (
    <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-cloud-sandbox.apiName.grepContent')}: </span>
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
            ({t('builtins.lobe-local-system.inspector.noResults')})
          </Text>
        ))}
    </div>
  );
});

GrepContentInspector.displayName = 'GrepContentInspector';
