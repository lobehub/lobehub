'use client';

import type { GlobFilesParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { GlobFilesState } from '../../..';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

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

    // Check if glob was successful
    const isSuccess = pluginState?.result?.success;
    const engine = pluginState?.result?.engine;

    return (
      <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
        <span style={{ marginInlineStart: 2 }}>
          <span>{t('builtins.lobe-local-system.apiName.globLocalFiles')}: </span>
          {pattern && <span className={highlightTextStyles.primary}>{pattern}</span>}
          {isLoading ? null : pluginState?.result ? (
            isSuccess ? (
              <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
            ) : (
              <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
            )
          ) : null}
          {!isLoading && engine && (
            <Text
              as={'span'}
              color={cssVar.colorTextDescription}
              fontSize={12}
              style={{ marginInlineStart: 4 }}
            >
              [{engine}]
            </Text>
          )}
        </span>
      </div>
    );
  },
);

GlobLocalFilesInspector.displayName = 'GlobLocalFilesInspector';
