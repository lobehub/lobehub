'use client';

import { type GlobFilesParams } from '@lobechat/electron-client-ipc';
import { type BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import { type GlobFilesState } from '../../..';

export const GlobLocalFilesInspector = memo<BuiltinInspectorProps<GlobFilesParams, GlobFilesState>>(
  ({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
    const { t } = useTranslation('plugin');

    const pattern = args?.pattern || partialArgs?.pattern || '';

    // During argument streaming
    if (isArgumentsStreaming) {
      if (!pattern)
        return (
          <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
            <span>{t('builtins.lobe-local-system.apiName.globLocalFiles')}</span>
          </div>
        );

      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.apiName.globLocalFiles')}: </span>
          <span className={highlightTextStyles.primary}>{pattern}</span>
        </div>
      );
    }

    // Check result count
    const resultCount = pluginState?.result?.total_files ?? 0;
    const hasResults = resultCount > 0;

    return (
      <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.apiName.globLocalFiles')}: </span>
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
  },
);

GlobLocalFilesInspector.displayName = 'GlobLocalFilesInspector';
