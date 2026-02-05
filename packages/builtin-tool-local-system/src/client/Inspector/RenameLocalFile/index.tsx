'use client';

import type { RenameLocalFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { MaterialFileTypeIcon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import path from 'path-browserify-esm';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { LocalRenameFileState } from '../../..';

const styles = createStaticStyles(({ css }) => ({
  icon: css`
    flex-shrink: 0;
    margin-inline-end: 4px;
  `,
}));

export const RenameLocalFileInspector = memo<
  BuiltinInspectorProps<RenameLocalFileParams, LocalRenameFileState>
>(({ args, partialArgs, isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  const filePath = args?.path || partialArgs?.path || '';
  const newName = args?.newName || partialArgs?.newName || '';

  // Get the old filename from path
  const oldName = filePath ? path.basename(filePath) : '';

  return (
    <div
      className={cx(inspectorTextStyles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
    >
      {oldName && newName ? (
        <>
          {t('builtins.lobe-local-system.apiName.renameLocalFile')} {oldName} →{' '}
          <MaterialFileTypeIcon
            className={styles.icon}
            filename={newName}
            size={16}
            type={'file'}
            variant={'raw'}
          />
          <span className={highlightTextStyles.primary}>{newName}</span>
        </>
      ) : (
        <span>{t('builtins.lobe-local-system.apiName.renameLocalFile')}</span>
      )}
    </div>
  );
});

RenameLocalFileInspector.displayName = 'RenameLocalFileInspector';
