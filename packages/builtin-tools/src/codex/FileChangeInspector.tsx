'use client';

import { FilePathDisplay } from '@lobechat/shared-tool-ui/components';
import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';

import { type CodexFileChangeArgs, type CodexFileChangeState, getFileChangeStats } from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 999px;

    background: ${cssVar.colorFillTertiary};
  `,
  count: css`
    margin-inline-start: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  lineAdded: css`
    margin-inline-start: 6px;
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorSuccess};
  `,
  lineDeleted: css`
    margin-inline-start: 4px;
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorError};
  `,
}));

const FileChangeInspector = memo<BuiltinInspectorProps<CodexFileChangeArgs, CodexFileChangeState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const stats = getFileChangeStats(args || partialArgs, pluginState);
    const hasLineStats = stats.linesAdded > 0 || stats.linesDeleted > 0;

    if (isArgumentsStreaming && !stats.firstPath) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>File changes</div>
      );
    }

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>File changes:</span>
        {stats.firstPath && (
          <span className={styles.chip}>
            <FilePathDisplay filePath={stats.firstPath} />
          </span>
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
