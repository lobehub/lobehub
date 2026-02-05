'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ReadKnowledgeArgs, ReadKnowledgeState } from '../../..';

const styles = createStaticStyles(({ css, cssVar }) => ({
  moreFiles: css`
    margin-inline-start: 4px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

export const ReadKnowledgeInspector = memo<
  BuiltinInspectorProps<ReadKnowledgeArgs, ReadKnowledgeState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const fileIds = args?.fileIds || partialArgs?.fileIds || [];
  const fileCount = fileIds.length;
  const files = pluginState?.files || [];
  const firstFilename = files[0]?.filename;
  const remainingCount = files.length - 1;

  // During argument streaming - show file count since we don't have filenames yet
  if (isArgumentsStreaming) {
    if (fileCount === 0)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-knowledge-base.apiName.readKnowledge')}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-knowledge-base.apiName.readKnowledge')}: </span>
        <span className={highlightTextStyles.gold}>
          {fileCount} {fileCount === 1 ? 'file' : 'files'}
        </span>
      </div>
    );
  }

  // After loading - show filename(s)
  const renderFileInfo = () => {
    // If we have filenames from pluginState, show them
    if (firstFilename) {
      return (
        <>
          <span className={highlightTextStyles.gold}>{firstFilename}</span>
          {remainingCount > 0 && (
            <span className={styles.moreFiles}>
              {t('builtins.lobe-knowledge-base.inspector.andMoreFiles', { count: remainingCount })}
            </span>
          )}
        </>
      );
    }
    // Fallback to file count if no filenames available yet
    if (fileCount > 0) {
      return (
        <span className={highlightTextStyles.gold}>
          {fileCount} {fileCount === 1 ? 'file' : 'files'}
        </span>
      );
    }
    return null;
  };

  return (
    <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
      <span style={{ marginInlineStart: 2 }}>
        <span>{t('builtins.lobe-knowledge-base.apiName.readKnowledge')}: </span>
        {renderFileInfo()}
      </span>
    </div>
  );
});

ReadKnowledgeInspector.displayName = 'ReadKnowledgeInspector';
