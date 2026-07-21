'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';

/**
 * Shared UI primitives for rendering a file change (a colored kind dot + a
 * `+added -deleted` line-stat pill) plus the path helpers they need. Downed here
 * from the codex `FileChangeRender` and the conversation `EditedFilesCard`, which
 * both consume this package, so the two stop hand-rolling the same styles.
 */

/** Change kind shared by the codex file-change and edited-files renderers. */
export type FileChangeKind = 'added' | 'deleted' | 'modified' | 'renamed';

const styles = createStaticStyles(({ css }) => ({
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
}));

const KIND_CLASS: Record<FileChangeKind, string> = {
  added: styles.kindAdded,
  deleted: styles.kindDeleted,
  modified: styles.kindModified,
  renamed: styles.kindRenamed,
};

/** A small color-coded dot indicating a file's change kind. */
export const KindDot = memo<{ className?: string; kind: FileChangeKind }>(({ className, kind }) => (
  <span className={cx(styles.kindDot, KIND_CLASS[kind], className)} />
));
KindDot.displayName = 'FileChangeKindDot';

interface LineStatsProps {
  className?: string;
  /**
   * When set, a zero side is hidden individually (only render `+N` when N > 0
   * and `-M` when M > 0). Default renders both sides whenever either is non-zero.
   */
  hideZeroDeltas?: boolean;
  linesAdded?: number;
  linesDeleted?: number;
}

/** A `+added -deleted` git-diff-stat pill; renders nothing when both are zero. */
export const LineStats = memo<LineStatsProps>(
  ({ className, hideZeroDeltas, linesAdded = 0, linesDeleted = 0 }) => {
    if (linesAdded === 0 && linesDeleted === 0) return null;

    const showAdded = !hideZeroDeltas || linesAdded > 0;
    const showDeleted = !hideZeroDeltas || linesDeleted > 0;

    return (
      <span className={cx(styles.lineStats, className)}>
        {showAdded && <span className={styles.lineAdded}>+{linesAdded}</span>}
        {showDeleted && <span className={styles.lineDeleted}>-{linesDeleted}</span>}
      </span>
    );
  },
);
LineStats.displayName = 'FileChangeLineStats';

/** Display file name: the last non-empty path segment, falling back to the input. */
export const getFileName = (filePath: string): string => {
  if (!filePath) return '';
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.split('/').findLast(Boolean) || filePath;
};

/**
 * Best-effort language hint (lowercased extension) for syntax highlighting a
 * file's diff, or undefined when there is none. A leading-dot dotfile with no
 * real extension (e.g. `.env`) has no language.
 */
export const getFileLanguage = (filePath: string): string | undefined => {
  const fileName = getFileName(filePath);
  const index = fileName.lastIndexOf('.');
  if (index <= 0 || index === fileName.length - 1) return undefined;
  return fileName.slice(index + 1).toLowerCase();
};
