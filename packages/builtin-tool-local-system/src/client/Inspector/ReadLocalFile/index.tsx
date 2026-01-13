'use client';

import { type LocalReadFileParams } from '@lobechat/electron-client-ipc';
import { type BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import { type LocalReadFileState } from '../../..';
import { FilePathDisplay } from '../../components/FilePathDisplay';

export const ReadLocalFileInspector = memo<
  BuiltinInspectorProps<LocalReadFileParams, LocalReadFileState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const filePath = args?.path || partialArgs?.path || '';

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!filePath)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.apiName.readLocalFile')}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.apiName.readLocalFile')}: </span>
        <FilePathDisplay filePath={filePath} />
      </div>
    );
  }

  return (
    <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-local-system.apiName.readLocalFile')}: </span>
      <FilePathDisplay filePath={filePath} />
    </div>
  );
});

ReadLocalFileInspector.displayName = 'ReadLocalFileInspector';
