'use client';

import type { GitWorkingTreePatch } from '@lobechat/electron-client-ipc';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { type KeyboardEvent, memo, useCallback } from 'react';

import { sx } from '@/styles/sx';

import type { ComposerTarget } from '../../types';
import FileItemBody, { FileItemHeader } from './FileItem';
import type { ReviewMode } from './useReviewPatches';

const styles = stylex.create({
  item: {
    // Skip layout/paint of off-screen rows. Preserved from the previous
    // implementation.
    contentVisibility: 'auto',
    containIntrinsicSize: 'auto 32px',
    flex: 'none',
    // Every row carries its own top border — separates file-from-file AND
    // file-from-header without doubling up when a group is collapsed. The first
    // child of the list drops it: the list's own top border is the separator.
    borderBlockStartWidth: { 'default': '1px', ':first-child': 0 },
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  row: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    width: '100%',
    paddingBlock: '5px',
    paddingInline: '10px',
    transition: 'background 0.12s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
  },
  chevron: {
    flex: 'none',
    color: cssVar.colorTextTertiary,
    transition: 'transform 0.2s',
    transform: { 'default': null, "[data-expanded='true']": 'rotate(90deg)' },
  },
});

interface FileRowProps {
  composerTarget: ComposerTarget;
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
  /** The diff text is still loading (row comes from the persisted summary). */
  pending?: boolean;
  /** Absolute path of the owning repo — used as the working directory for
   * revert operations so submodule files revert inside the submodule, not
   * the parent repo. */
  repoAbsolutePath: string;
  /** The row comes from the persisted summary, not the live read: revert stays
   * disabled until the device confirms what the path holds now. */
  stale?: boolean;
  textDiff: boolean;
  viewMode: 'unified' | 'split';
  wordWrap: boolean;
}

const FileRow = memo<FileRowProps>(
  ({
    composerTarget,
    dataFileKey,
    deviceId,
    entry,
    expanded,
    hideDir,
    indent,
    mode,
    onReverted,
    onToggle,
    pending,
    repoAbsolutePath,
    stale,
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
      <div {...stylex.props(styles.item)} data-file-key={dataFileKey}>
        <div
          data-review-row
          aria-expanded={expanded}
          role={'button'}
          {...sx(
            [styles.row, stylex.defaultMarker()],
            undefined,
            indent ? { paddingInlineStart: 10 + indent } : undefined,
          )}
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={onKeyDown}
        >
          <ChevronRightIcon
            {...stylex.props(styles.chevron)}
            data-expanded={expanded ? 'true' : 'false'}
            size={14}
          />
          <FileItemHeader
            additions={entry.additions}
            deletions={entry.deletions}
            filePath={entry.filePath}
            hideDir={hideDir}
            revertDisabled={stale}
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
                composerTarget={composerTarget}
                filePath={entry.filePath}
                isBinary={entry.isBinary}
                patch={entry.patch}
                pending={pending}
                textDiff={textDiff}
                truncated={entry.truncated}
                viewMode={viewMode}
                wordWrap={wordWrap}
                workingDirectory={repoAbsolutePath}
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
