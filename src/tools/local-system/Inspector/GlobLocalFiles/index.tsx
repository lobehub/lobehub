'use client';

import { type GlobFilesState } from '@lobechat/builtin-tool-local-system';
import { type GlobFilesParams } from '@lobechat/electron-client-ipc';
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

export const GlobLocalFilesInspector = memo<BuiltinInspectorProps<GlobFilesParams, GlobFilesState>>(
  ({ args, isLoading }) => {
    const { t } = useTranslation('plugin');

    const pattern = args?.pattern || '';

    // When loading, show "本地系统 > 匹配搜索文件"
    if (isLoading) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.title')}</span>
          <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
          <span>{t('builtins.lobe-local-system.apiName.globLocalFiles')}</span>
        </div>
      );
    }

    return (
      <div className={styles.root}>
        <span>{t('builtins.lobe-local-system.apiName.globLocalFiles')}</span>
        {pattern && (
          <>
            <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
            <span className={styles.content}>{pattern}</span>
          </>
        )}
      </div>
    );
  },
);

GlobLocalFilesInspector.displayName = 'GlobLocalFilesInspector';
