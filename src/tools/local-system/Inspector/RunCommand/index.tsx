'use client';

import { type RunCommandParams, type RunCommandResult } from '@lobechat/electron-client-ipc';
import { type BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextDescription};
  `,
}));

interface RunCommandState {
  message: string;
  result: RunCommandResult;
}

export const RunCommandInspector = memo<BuiltinInspectorProps<RunCommandParams, RunCommandState>>(
  ({ args, isLoading }) => {
    const { t } = useTranslation('plugin');

    // Show description if available, otherwise show command
    const displayText = args?.description || args?.command || '';

    // When loading, show "Local System > 执行命令"
    if (isLoading) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.title')}</span>
          <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
          <span>{t('builtins.lobe-local-system.apiName.runCommand')}</span>
        </div>
      );
    }

    return (
      <div className={styles.root}>
        <span>{t('builtins.lobe-local-system.apiName.runCommand')}</span>
        {displayText && (
          <>
            <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
            <span className={styles.content}>{displayText}</span>
          </>
        )}
      </div>
    );
  },
);

RunCommandInspector.displayName = 'RunCommandInspector';

export default RunCommandInspector;
