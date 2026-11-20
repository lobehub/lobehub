'use client';

import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

/**
 * Shared UI primitives for rendering a file change (a colored kind dot + a
 * `+added -deleted` line-stat pill) plus the path helpers they need. Downed here
 * from the codex `FileChangeRender` and the conversation `EditedFilesCard`, which
 * both consume this package, so the two stop hand-rolling the same styles.
 */

/** Change kind shared by the codex file-change and edited-files renderers. */
export type FileChangeKind = 'added' | 'deleted' | 'modified' | 'renamed';

const styles = stylex.create({
  kindAdded: { backgroundColor: cssVar.colorSuccess, backgroundImage: 'none' },
  kindDeleted: { backgroundColor: cssVar.colorError, backgroundImage: 'none' },
  kindDot: { flexShrink: 0, width: '8px', height: '8px', borderRadius: '999px' },
  kindModified: { backgroundColor: cssVar.colorInfo, backgroundImage: 'none' },
  kindRenamed: { backgroundColor: cssVar.colorWarning, backgroundImage: 'none' },
  lineAdded: { color: cssVar.colorSuccess },
  lineDeleted: { color: cssVar.colorError },
  lineStats: {
    display: 'inline-flex',
    flexShrink: 0,
    gap: '6px',
    alignItems: 'center',
    fontSize: '12px',
  },
});

const KIND_STYLE = {
  added: styles.kindAdded,
  deleted: styles.kindDeleted,
  modified: styles.kindModified,
  renamed: styles.kindRenamed,
} as const satisfies Record<FileChangeKind, unknown>;

/** A small color-coded dot indicating a file's change kind. */
export const KindDot = memo<{ className?: string; kind: FileChangeKind }>(({ className, kind }) => (
  <span className={cx(stylex.props(styles.kindDot, KIND_STYLE[kind]).className, className)} />
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
      <span className={cx(stylex.props(styles.lineStats).className, className)}>
        {showAdded && <span {...stylex.props(styles.lineAdded)}>+{linesAdded}</span>}
        {showDeleted && <span {...stylex.props(styles.lineDeleted)}>-{linesDeleted}</span>}
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
