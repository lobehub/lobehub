'use client';

import { FilePathDisplay } from '@lobechat/shared-tool-ui/components';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, PatchDiff, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

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
    color: ${cssVar.colorSuccess};
  `,
  lineDeleted: css`
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
    gap: 2px;
    min-width: 0;
    padding-block: 2px;
    padding-inline: 4px;
  `,
  patch: css`
    overflow: hidden;
    padding-block-end: 8px;
    padding-inline-start: 16px;
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
    gap: 8px;
    align-items: center;

    min-height: 26px;
    padding-block: 3px;
    padding-inline: 0;
  `,
  unknownPath: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const getFileName = (filePath: string): string => {
  if (!filePath) return '';
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.split('/').findLast(Boolean) || filePath;
};

const getFileLanguage = (filePath: string): string | undefined => {
  const fileName = getFileName(filePath);
  const index = fileName.lastIndexOf('.');
  if (index < 0 || index === fileName.length - 1) return;
  return fileName.slice(index + 1).toLowerCase();
};

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
    const { t } = useTranslation('plugin');
    const stats = getFileChangeStats(args, pluginState);
    const data = getFileChangeData(args, pluginState);

    if (stats.total === 0) {
      return (
        <Text className={styles.emptyState}>
          {t('builtins.codex.fileChange.noChanges', { defaultValue: 'No file changes' })}
        </Text>
      );
    }

    return (
      <Flexbox className={styles.list}>
        {data.changes.map((change, index) => {
          const kind = getFileChangeKind(change.kind);
          const path = change.path || '';

          return (
            <Flexbox key={`${path}-${index}`}>
              <Flexbox horizontal className={styles.row}>
                <span className={cx(styles.kindDot, getKindClassName(kind))} />
                <div className={styles.rowMain}>
                  <div className={styles.path}>
                    {path ? (
                      <FilePathDisplay filePath={path} />
                    ) : (
                      <Text className={styles.unknownPath}>
                        {t('builtins.codex.fileChange.unknownFile', {
                          defaultValue: 'Unknown file',
                        })}
                      </Text>
                    )}
                  </div>
                  <LineStats linesAdded={change.linesAdded} linesDeleted={change.linesDeleted} />
                </div>
              </Flexbox>
              {change.diffText && (
                <div className={styles.patch}>
                  <PatchDiff
                    fileName={getFileName(path)}
                    language={getFileLanguage(path)}
                    patch={change.diffText}
                    showHeader={false}
                    variant="borderless"
                    viewMode="unified"
                  />
                </div>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>
    );
  },
);

FileChangeRender.displayName = 'CodexFileChangeRender';

export default FileChangeRender;
