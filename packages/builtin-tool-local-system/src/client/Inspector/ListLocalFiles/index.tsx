'use client';

import type { ListLocalFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { LocalFileListState } from '../../..';
import { FilePathDisplay } from '../../components/FilePathDisplay';

export const ListLocalFilesInspector = memo<
  BuiltinInspectorProps<ListLocalFileParams, LocalFileListState>
>(({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
  const { t } = useTranslation('plugin');

  const path = args?.path || partialArgs?.path || '';

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!path)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.apiName.listLocalFiles')}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.apiName.listLocalFiles')}: </span>
        <FilePathDisplay isDirectory filePath={path} />
      </div>
    );
  }

  // Show result count if available
  const resultCount = pluginState?.listResults?.length ?? 0;
  const hasResults = resultCount > 0;

  return (
    <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-local-system.apiName.listLocalFiles')}: </span>
      <FilePathDisplay isDirectory filePath={path} />
      {!isLoading &&
        pluginState?.listResults &&
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
});

ListLocalFilesInspector.displayName = 'ListLocalFilesInspector';
