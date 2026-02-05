'use client';

import type { EditLocalFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { EditLocalFileState } from '../../../types';
import { FilePathDisplay } from '../../components/FilePathDisplay';

const styles = createStaticStyles(({ css, cssVar }) => ({
  separator: css`
    margin-inline: 2px;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

export const EditLocalFileInspector = memo<
  BuiltinInspectorProps<EditLocalFileParams, EditLocalFileState>
>(({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
  const { t } = useTranslation('plugin');

  const filePath = args?.file_path || partialArgs?.file_path || '';

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!filePath)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.apiName.editLocalFile')}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.apiName.editLocalFile')}: </span>
        <FilePathDisplay filePath={filePath} />
      </div>
    );
  }

  // Build stats parts with colors and icons
  const linesAdded = pluginState?.linesAdded ?? 0;
  const linesDeleted = pluginState?.linesDeleted ?? 0;

  const statsParts: ReactNode[] = [];
  if (linesAdded > 0) {
    statsParts.push(
      <Text code as={'span'} color={cssVar.colorSuccess} fontSize={12} key="added">
        <Icon icon={Plus} size={12} />
        {linesAdded}
      </Text>,
    );
  }
  if (linesDeleted > 0) {
    statsParts.push(
      <Text code as={'span'} color={cssVar.colorError} fontSize={12} key="deleted">
        <Icon icon={Minus} size={12} />
        {linesDeleted}
      </Text>,
    );
  }

  return (
    <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-local-system.apiName.editLocalFile')}: </span>
      <FilePathDisplay filePath={filePath} />
      {!isLoading && statsParts.length > 0 && (
        <>
          {' '}
          {statsParts.map((part, index) => (
            <span key={index}>
              {index > 0 && <span className={styles.separator}> / </span>}
              {part}
            </span>
          ))}
        </>
      )}
    </div>
  );
});

EditLocalFileInspector.displayName = 'EditLocalFileInspector';
