'use client';

import { FilePathDisplay } from '@lobechat/shared-tool-ui/components';
import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type CodexFileChangeArgs, type CodexFileChangeState, getFileChangeStats } from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    margin-inline-start: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  lineAdded: css`
    margin-inline-start: 6px;
    font-size: 12px;
    color: ${cssVar.colorSuccess};
  `,
  lineDeleted: css`
    margin-inline-start: 4px;
    font-size: 12px;
    color: ${cssVar.colorError};
  `,
  summary: css`
    margin-inline-end: 6px;
  `,
}));

const FileChangeInspector = memo<BuiltinInspectorProps<CodexFileChangeArgs, CodexFileChangeState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');
    const stats = getFileChangeStats(args || partialArgs, pluginState);
    const hasLineStats = stats.linesAdded > 0 || stats.linesDeleted > 0;
    const isEditing = isArgumentsStreaming || isLoading;
    const summary = isEditing
      ? t('builtins.codex.fileChange.editing', { defaultValue: 'Editing files' })
      : stats.total > 0
        ? t('builtins.codex.fileChange.editedFiles', {
            count: stats.total,
            defaultValue: stats.total === 1 ? 'Edited {{count}} file' : 'Edited {{count}} files',
          })
        : t('builtins.codex.fileChange.noChanges', { defaultValue: 'No file changes' });

    if (isEditing && !stats.firstPath) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{summary}</div>
      );
    }

    return (
      <div className={cx(inspectorTextStyles.root, isEditing && shinyTextStyles.shinyText)}>
        {stats.firstPath ? (
          <>
            <span className={styles.summary}>{summary}:</span>
            <FilePathDisplay filePath={stats.firstPath} />
          </>
        ) : (
          <span>{summary}</span>
        )}
        {stats.total > 1 && <span className={styles.count}>+{stats.total - 1}</span>}
        {hasLineStats && (
          <>
            <span className={styles.lineAdded}>+{stats.linesAdded}</span>
            <span className={styles.lineDeleted}>-{stats.linesDeleted}</span>
          </>
        )}
      </div>
    );
  },
);

FileChangeInspector.displayName = 'CodexFileChangeInspector';

export default FileChangeInspector;
