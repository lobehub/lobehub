'use client';

import { type LocalFileSearchState } from '@lobechat/builtin-tool-local-system';
import { type LocalSearchFilesParams } from '@lobechat/electron-client-ipc';
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

export const SearchLocalFilesInspector = memo<
  BuiltinInspectorProps<LocalSearchFilesParams, LocalFileSearchState>
>(({ args, isLoading }) => {
  const { t } = useTranslation('plugin');

  const keywords = args?.keywords || '';

  // When loading, show "本地系统 > 搜索文件"
  if (isLoading) {
    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.title')}</span>
        <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
        <span>{t('builtins.lobe-local-system.apiName.searchLocalFiles')}</span>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <span>{t('builtins.lobe-local-system.apiName.searchLocalFiles')}</span>
      {keywords && (
        <>
          <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
          <span className={styles.content}>{keywords}</span>
        </>
      )}
    </div>
  );
});

SearchLocalFilesInspector.displayName = 'SearchLocalFilesInspector';
