'use client';

import { type LocalReadFileParams } from '@lobechat/electron-client-ipc';
import { type BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import { type LocalReadFileState } from '../../..';
import { FilePathDisplay } from '../../components/FilePathDisplay';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
}));

export const ReadLocalFileInspector = memo<
  BuiltinInspectorProps<LocalReadFileParams, LocalReadFileState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const filePath = args?.path || partialArgs?.path || '';

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!filePath)
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.apiName.readLocalFile')}</span>
        </div>
      );

    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.apiName.readLocalFile')}: </span>
        <FilePathDisplay filePath={filePath} />
      </div>
    );
  }

  return (
    <div className={cx(styles.root, isLoading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-local-system.apiName.readLocalFile')}: </span>
      <FilePathDisplay filePath={filePath} />
    </div>
  );
});

ReadLocalFileInspector.displayName = 'ReadLocalFileInspector';
