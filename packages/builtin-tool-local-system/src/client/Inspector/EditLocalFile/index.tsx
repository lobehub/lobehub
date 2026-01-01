'use client';

import { type EditLocalFileParams } from '@lobechat/electron-client-ipc';
import { type BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import { type EditLocalFileState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

export const EditLocalFileInspector = memo<
  BuiltinInspectorProps<EditLocalFileParams, EditLocalFileState>
>(({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
  const { t } = useTranslation('plugin');

  // Show filename with parent directory for context
  const filePath = args?.file_path || partialArgs?.file_path || '';
  let displayPath = '';
  if (filePath) {
    const { base, dir } = path.parse(filePath);
    const parentDir = path.basename(dir);
    displayPath = parentDir ? `${parentDir}/${base}` : base;
  }

  // During argument streaming
  if (isArgumentsStreaming) {
    if (!displayPath)
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.apiName.editLocalFile')}</span>
        </div>
      );

    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.apiName.editLocalFile')}: </span>
        <span className={highlightTextStyles.primary}>{displayPath}</span>
      </div>
    );
  }

  // Check if edit was successful (has replacements count)
  const isSuccess = pluginState?.replacements !== undefined && pluginState.replacements >= 0;

  return (
    <div className={cx(styles.root, isLoading && shinyTextStyles.shinyText)}>
      <span style={{ marginInlineStart: 2 }}>
        <span>{t('builtins.lobe-local-system.apiName.editLocalFile')}: </span>
        {displayPath && <span className={highlightTextStyles.primary}>{displayPath}</span>}
        {isLoading ? null : pluginState ? (
          isSuccess ? (
            <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
          ) : (
            <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
          )
        ) : null}
      </span>
    </div>
  );
});

EditLocalFileInspector.displayName = 'EditLocalFileInspector';
