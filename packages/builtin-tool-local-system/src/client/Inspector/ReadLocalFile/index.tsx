'use client';

import { type LocalReadFileParams } from '@lobechat/electron-client-ipc';
import { type BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import { type LocalReadFileState } from '../../..';

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

export const ReadLocalFileInspector = memo<
  BuiltinInspectorProps<LocalReadFileParams, LocalReadFileState>
>(({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
  const { t } = useTranslation('plugin');

  // Show filename with parent directory for context
  const filePath = args?.path || partialArgs?.path || '';
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
          <span>{t('builtins.lobe-local-system.apiName.readLocalFile')}</span>
        </div>
      );

    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.apiName.readLocalFile')}: </span>
        <span className={highlightTextStyles.primary}>{displayPath}</span>
      </div>
    );
  }

  // Check if file was read successfully (has content)
  const hasContent = !!pluginState?.fileContent;

  return (
    <div className={cx(styles.root, isLoading && shinyTextStyles.shinyText)}>
      <span style={{ marginInlineStart: 2 }}>
        <span>{t('builtins.lobe-local-system.apiName.readLocalFile')}: </span>
        {displayPath && <span className={highlightTextStyles.primary}>{displayPath}</span>}
        {isLoading ? null : pluginState ? (
          hasContent ? (
            <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
          ) : (
            <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
          )
        ) : null}
      </span>
    </div>
  );
});

ReadLocalFileInspector.displayName = 'ReadLocalFileInspector';
