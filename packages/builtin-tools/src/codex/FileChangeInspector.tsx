'use client';

import { FilePathDisplay } from '@lobechat/shared-tool-ui/components';
import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type CodexFileChangeArgs, type CodexFileChangeState, getFileChangeStats } from './utils';

const styles = stylex.create({
  count: { marginInlineStart: '4px', fontSize: '12px', color: cssVar.colorTextTertiary },
  lineAdded: { marginInlineStart: '6px', fontSize: '12px', color: cssVar.colorSuccess },
  lineDeleted: { marginInlineStart: '4px', fontSize: '12px', color: cssVar.colorError },
  summary: { marginInlineEnd: '6px' },
});

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
            <span {...stylex.props(styles.summary)}>{summary}:</span>
            <FilePathDisplay filePath={stats.firstPath} />
          </>
        ) : (
          <span>{summary}</span>
        )}
        {stats.total > 1 && <span {...stylex.props(styles.count)}>+{stats.total - 1}</span>}
        {hasLineStats && (
          <>
            <span {...stylex.props(styles.lineAdded)}>+{stats.linesAdded}</span>
            <span {...stylex.props(styles.lineDeleted)}>-{stats.linesDeleted}</span>
          </>
        )}
      </div>
    );
  },
);

FileChangeInspector.displayName = 'CodexFileChangeInspector';

export default FileChangeInspector;
