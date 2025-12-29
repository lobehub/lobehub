'use client';

import { type GrepContentState } from '@lobechat/builtin-tool-local-system';
import { type GrepContentParams } from '@lobechat/electron-client-ipc';
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

export const GrepContentInspector = memo<
  BuiltinInspectorProps<GrepContentParams, GrepContentState>
>(({ args, isLoading }) => {
  const { t } = useTranslation('plugin');

  const pattern = args?.pattern || '';

  // When loading, show "本地系统 > 搜索内容"
  if (isLoading) {
    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.title')}</span>
        <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
        <span>{t('builtins.lobe-local-system.apiName.grepContent')}</span>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <span>{t('builtins.lobe-local-system.apiName.grepContent')}</span>
      {pattern && (
        <>
          <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
          <span className={styles.content}>{pattern}</span>
        </>
      )}
    </div>
  );
});

GrepContentInspector.displayName = 'GrepContentInspector';
