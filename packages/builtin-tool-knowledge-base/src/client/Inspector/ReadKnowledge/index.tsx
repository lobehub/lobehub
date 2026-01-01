'use client';

import { type BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import { type ReadKnowledgeArgs, type ReadKnowledgeState } from '../../..';

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

export const ReadKnowledgeInspector = memo<
  BuiltinInspectorProps<ReadKnowledgeArgs, ReadKnowledgeState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const fileIds = args?.fileIds || partialArgs?.fileIds || [];
  const fileCount = fileIds.length;

  // During argument streaming
  if (isArgumentsStreaming) {
    if (fileCount === 0)
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-knowledge-base.apiName.readKnowledge')}</span>
        </div>
      );

    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-knowledge-base.apiName.readKnowledge')}: </span>
        <span className={highlightTextStyles.gold}>
          {fileCount} {fileCount === 1 ? 'file' : 'files'}
        </span>
      </div>
    );
  }

  return (
    <div className={cx(styles.root, isLoading && shinyTextStyles.shinyText)}>
      <span style={{ marginInlineStart: 2 }}>
        <span>{t('builtins.lobe-knowledge-base.apiName.readKnowledge')}: </span>
        {fileCount > 0 && (
          <span className={highlightTextStyles.gold}>
            {fileCount} {fileCount === 1 ? 'file' : 'files'}
          </span>
        )}
      </span>
    </div>
  );
});

ReadKnowledgeInspector.displayName = 'ReadKnowledgeInspector';
