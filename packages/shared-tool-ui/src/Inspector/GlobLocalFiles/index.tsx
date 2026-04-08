'use client';

import type { GlobFilesState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '../../styles';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

interface GlobFilesArgs {
  directory?: string;
  pattern?: string;
}

export const createGlobLocalFilesInspector = (translationKey: string) => {
  const Inspector = memo<BuiltinInspectorProps<GlobFilesArgs, GlobFilesState>>(
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

      const hasFiles = (pluginState?.totalCount ?? 0) > 0;

      return (
        <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
          <span style={{ marginInlineStart: 2 }}>
            <span>{t(translationKey as any)}: </span>
            {pattern && <span className={highlightTextStyles.primary}>{pattern}</span>}
            {isLoading ? null : pluginState ? (
              hasFiles ? (
                <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
              ) : (
                <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
              )
            ) : null}
          </span>
        </div>
      );
    },
  );
  Inspector.displayName = 'GlobLocalFilesInspector';
  return Inspector;
};
