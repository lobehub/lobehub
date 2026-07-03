'use client';

import type { GitWorkingTreePatch } from '@lobechat/electron-client-ipc';
import { createStaticStyles } from 'antd-style';
import { ChevronRightIcon } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { type KeyboardEvent, memo, useCallback } from 'react';

import FileItemBody, { FileItemHeader } from './FileItem';
import type { ReviewMode } from './useReviewPatches';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    /* Skip layout/paint of off-screen rows. Preserved from the previous
       implementation. */
    content-visibility: auto;
    contain-intrinsic-size: auto 32px;
    flex: none;

    /* Every row carries its own top border — separates file-from-file AND
       file-from-header without doubling up when a group is collapsed. */
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  row: css`
    cursor: pointer;
    user-select: none;

    display: flex;
    gap: 6px;
    align-items: center;

    width: 100%;
    padding-block: 5px;
    padding-inline: 10px;

    transition: background 0.12s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  chevron: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
    transition: transform 0.2s;

    &[data-expanded='true'] {
      transform: rotate(90deg);
    }
  `,
}));

interface FileRowProps {
  /** Scroll anchor — the tree-nav rail scrolls to `[data-file-key]` on select. */
  dataFileKey?: string;
  /** Target device the repo lives on — undefined for local desktop. */
  deviceId?: string;
  entry: GitWorkingTreePatch;
  expanded: boolean;
  /** Hide the leading directory portion (tree layout shows folders already). */
  hideDir?: boolean;
  /** Extra inline-start padding (px) for nested tree rows. Applied to the
   * clickable header row only — the expanded diff stays full-width. */
  indent?: number;
  mode: ReviewMode;
  onReverted: () => void;
  onToggle: () => void;
  /** Absolute path of the owning repo — used as the working directory for
   * revert operations so submodule files revert inside the submodule, not
   * the parent repo. */
  repoAbsolutePath: string;
  textDiff: boolean;
  viewMode: 'unified' | 'split';
  wordWrap: boolean;
}

const FileRow = memo<FileRowProps>(
  ({
    dataFileKey,
    deviceId,
    entry,
    expanded,
    hideDir,
    indent,
    mode,
    onReverted,
    onToggle,
    repoAbsolutePath,
    textDiff,
    viewMode,
    wordWrap,
  }) => {
    const onKeyDown = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      },
      [onToggle],
    );
    return (
      <div className={styles.item} data-file-key={dataFileKey}>
        <div
          data-review-row
          aria-expanded={expanded}
          className={styles.row}
          role={'button'}
          style={indent ? { paddingInlineStart: 10 + indent } : undefined}
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={onKeyDown}
        >
          <ChevronRightIcon
            className={styles.chevron}
            data-expanded={expanded ? 'true' : 'false'}
            size={14}
          />
          <FileItemHeader
            additions={entry.additions}
            deletions={entry.deletions}
            filePath={entry.filePath}
            hideDir={hideDir}
            status={entry.status}
            revertContext={
              mode === 'unstaged' ? { deviceId, workingDirectory: repoAbsolutePath } : undefined
            }
            onReverted={onReverted}
          />
        </div>
        <AnimatePresence initial={false}>
          {expanded && (
            <m.div
              animate={'open'}
              exit={'collapsed'}
              initial={'collapsed'}
              style={{ overflow: 'hidden' }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              variants={{
                collapsed: { height: 0, opacity: 0 },
                open: { height: 'auto', opacity: 1 },
              }}
            >
              <FileItemBody
                expanded
                filePath={entry.filePath}
                isBinary={entry.isBinary}
                patch={entry.patch}
                textDiff={textDiff}
                truncated={entry.truncated}
                viewMode={viewMode}
                wordWrap={wordWrap}
              />
            </m.div>
          )}
        </AnimatePresence>
      </div>
    );
  },
);

FileRow.displayName = 'AgentWorkingSidebarReviewFileRow';

export default FileRow;
