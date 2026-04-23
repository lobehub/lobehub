'use client';

import { FilePathDisplay, ToolResultCard } from '@lobechat/shared-tool-ui/components';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Files, FileText } from 'lucide-react';
import { memo } from 'react';

import {
  type CodexFileChangeArgs,
  type CodexFileChangeKind,
  type CodexFileChangeState,
  getFileChangeData,
  getFileChangeKind,
  getFileChangeStats,
} from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  emptyState: css`
    padding: 4px;
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  header: css`
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    min-width: 0;
  `,
  headerChip: css`
    overflow: hidden;
    display: inline-flex;
    flex: 0 1 auto;
    align-items: center;

    min-width: 0;
    max-width: 100%;
    padding-block: 4px;
    padding-inline: 10px;
    border-radius: 999px;

    background: ${cssVar.colorFillTertiary};
  `,
  headerCount: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  headerLabel: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  kindAdded: css`
    background: ${cssVar.colorSuccess};
  `,
  kindDeleted: css`
    background: ${cssVar.colorError};
  `,
  kindDot: css`
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 999px;
  `,
  kindModified: css`
    background: ${cssVar.colorInfo};
  `,
  kindRenamed: css`
    background: ${cssVar.colorWarning};
  `,
  lineAdded: css`
    font-weight: 600;
    color: ${cssVar.colorSuccess};
  `,
  lineDeleted: css`
    font-weight: 600;
    color: ${cssVar.colorError};
  `,
  lineStats: css`
    display: inline-flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;

    font-size: 12px;
  `,
  list: css`
    gap: 0;
  `,
  panel: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorFillQuaternary};
  `,
  panelHeader: css`
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    padding: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  panelMeta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  panelTitle: css`
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  `,
  rowMain: css`
    display: flex;
    flex: 1;
    gap: 10px;
    align-items: center;

    min-width: 0;
  `,
  path: css`
    overflow: hidden;
    display: flex;
    align-items: center;
    min-width: 0;
  `,
  row: css`
    gap: 10px;
    align-items: center;
    padding: 12px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  unknownPath: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const getKindClassName = (kind: CodexFileChangeKind) => {
  switch (kind) {
    case 'added': {
      return styles.kindAdded;
    }
    case 'deleted': {
      return styles.kindDeleted;
    }
    case 'renamed': {
      return styles.kindRenamed;
    }
    default: {
      return styles.kindModified;
    }
  }
};

const LineStats = memo<{ className?: string; linesAdded?: number; linesDeleted?: number }>(
  ({ className, linesAdded = 0, linesDeleted = 0 }) => {
    if (linesAdded === 0 && linesDeleted === 0) return null;

    return (
      <span className={cx(styles.lineStats, className)}>
        <span className={styles.lineAdded}>+{linesAdded}</span>
        <span className={styles.lineDeleted}>-{linesDeleted}</span>
      </span>
    );
  },
);
LineStats.displayName = 'CodexFileChangeLineStats';

const FileChangeRender = memo<BuiltinRenderProps<CodexFileChangeArgs, CodexFileChangeState>>(
  ({ args, pluginState }) => {
    const stats = getFileChangeStats(args, pluginState);
    const data = getFileChangeData(args, pluginState);
    const summary = stats.total === 1 ? '1 file change' : `${stats.total} file changes`;
    const detail = [
      stats.byKind.added > 0 ? `${stats.byKind.added} added` : null,
      stats.byKind.modified > 0 ? `${stats.byKind.modified} modified` : null,
      stats.byKind.deleted > 0 ? `${stats.byKind.deleted} deleted` : null,
      stats.byKind.renamed > 0 ? `${stats.byKind.renamed} renamed` : null,
    ]
      .filter(Boolean)
      .join(', ');

    return (
      <ToolResultCard
        wrapHeader
        icon={FileText}
        header={
          <Flexbox horizontal align={'center'} className={styles.header} wrap={'wrap'}>
            <Text className={styles.headerLabel}>File changes:</Text>
            {stats.firstPath && (
              <span className={styles.headerChip}>
                <FilePathDisplay filePath={stats.firstPath} />
              </span>
            )}
            {stats.total > 1 && <Text className={styles.headerCount}>+{stats.total - 1}</Text>}
            <LineStats linesAdded={stats.linesAdded} linesDeleted={stats.linesDeleted} />
          </Flexbox>
        }
      >
        {stats.total > 0 ? (
          <div className={styles.panel}>
            <Flexbox horizontal align={'center'} className={styles.panelHeader} wrap={'wrap'}>
              <div className={styles.panelTitle}>
                <Icon icon={Files} size={16} />
                <Text strong>{summary}</Text>
              </div>
              {detail && <Text className={styles.panelMeta}>{detail}</Text>}
              <LineStats linesAdded={stats.linesAdded} linesDeleted={stats.linesDeleted} />
            </Flexbox>
            <Flexbox className={styles.list}>
              {data.changes.map((change, index) => {
                const kind = getFileChangeKind(change.kind);
                const path = change.path || '';

                return (
                  <Flexbox horizontal className={styles.row} key={`${path}-${index}`}>
                    <span className={cx(styles.kindDot, getKindClassName(kind))} />
                    <div className={styles.rowMain}>
                      <div className={styles.path}>
                        {path ? (
                          <FilePathDisplay filePath={path} />
                        ) : (
                          <Text className={styles.unknownPath}>Unknown file</Text>
                        )}
                      </div>
                      <LineStats
                        linesAdded={change.linesAdded}
                        linesDeleted={change.linesDeleted}
                      />
                    </div>
                  </Flexbox>
                );
              })}
            </Flexbox>
          </div>
        ) : (
          <Text className={styles.emptyState}>No file changes</Text>
        )}
      </ToolResultCard>
    );
  },
);

FileChangeRender.displayName = 'CodexFileChangeRender';

export default FileChangeRender;
