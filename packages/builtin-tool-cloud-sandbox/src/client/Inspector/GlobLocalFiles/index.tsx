'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { GlobFilesState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

interface GlobFilesParams {
  path?: string;
  pattern: string;
}

export const GlobLocalFilesInspector = memo<BuiltinInspectorProps<GlobFilesParams, GlobFilesState>>(
  ({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
    const { t } = useTranslation('plugin');

    const pattern = args?.pattern || partialArgs?.pattern || '';

    // During argument streaming
    if (isArgumentsStreaming) {
      if (!pattern)
        return (
          <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
            <span>{t('builtins.lobe-cloud-sandbox.apiName.globLocalFiles')}</span>
          </div>
        );

      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-cloud-sandbox.apiName.globLocalFiles')}: </span>
          <span className={highlightTextStyles.primary}>{pattern}</span>
        </div>
      );
    }

    // Check if glob was successful
    const totalCount = pluginState?.totalCount ?? 0;
    const hasResults = totalCount > 0;

    return (
      <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
        <span style={{ marginInlineStart: 2 }}>
          <span>{t('builtins.lobe-cloud-sandbox.apiName.globLocalFiles')}: </span>
          {pattern && <span className={highlightTextStyles.primary}>{pattern}</span>}
          {isLoading ? null : pluginState ? (
            hasResults ? (
              <>
                <span style={{ marginInlineStart: 4 }}>({totalCount})</span>
                <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
              </>
            ) : (
              <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
            )
          ) : null}
        </span>
      </div>
    );
  },
);

GlobLocalFilesInspector.displayName = 'GlobLocalFilesInspector';
