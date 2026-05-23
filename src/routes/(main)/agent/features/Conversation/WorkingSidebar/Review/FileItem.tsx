'use client';

import type { GitFileDiffStatus } from '@lobechat/electron-client-ipc';
import { ActionIcon, copyToClipboard, Flexbox, PatchDiff } from '@lobehub/ui';
import { Popconfirm } from 'antd';
import { createStaticStyles } from 'antd-style';
import { CopyIcon, LocateFixedIcon, Undo2Icon } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo, type MouseEvent, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { electronGitService } from '@/services/electron/git';
import { useGlobalStore } from '@/store/global';

const styles = createStaticStyles(({ css, cssVar }) => ({
  additions: css`
    color: ${cssVar.colorSuccess};
  `,
  // Hover-revealed row actions, anchored to the right edge with a gradient
  // mask that fades in from transparent → row hover-bg so any path/stats
  // text behind the icons softly disappears instead of being abruptly
  // overlapped. `:has(data-force-visible='true')` keeps the actions
  // up while a revert Popconfirm is open — otherwise the trigger would
  // collapse as soon as the cursor entered the popover.
  actions: css`
    pointer-events: none;

    position: absolute;
    inset-block: 0;
    inset-inline-end: -8px;

    align-items: center;

    padding-inline: 28px 0;

    opacity: 0;
    background:
      linear-gradient(to right, transparent 0, ${cssVar.colorFillTertiary} 28px),
      linear-gradient(to right, transparent 0, ${cssVar.colorBgContainer} 28px);

    transition: opacity 0.15s;

    &:has([data-force-visible='true']),
    [data-review-row]:hover & {
      pointer-events: auto;
      opacity: 1;
    }
  `,
  rowAction: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
  `,
  revertDanger: css`
    &:hover {
      color: ${cssVar.colorError};
    }
  `,
  deletions: css`
    color: ${cssVar.colorError};
  `,
  empty: css`
    padding-block: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  dir: css`
    direction: rtl;

    /* Only the directory portion shrinks + head-truncates. Short dirs
       sit naturally next to the filename (no awkward right-alignment);
       long dirs collapse leading segments into "…" via the RTL trick. */
    overflow: hidden;
    flex: 0 1 auto;

    min-width: 0;

    color: ${cssVar.colorTextTertiary};
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  fileName: css`
    flex: none;
    color: ${cssVar.colorText};
    white-space: nowrap;
  `,
  header: css`
    position: relative;

    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    min-width: 0;

    font-size: 12px;
  `,
  pathWrapper: css`
    overflow: hidden;

    /* Shrink-only (no grow): short paths stay content-sized so stats sit
       right after the filename; long paths still shrink so the dir part
       can head-truncate. */
    display: flex;
    flex: 0 1 auto;
    min-width: 0;
  `,
  stats: css`
    flex: none;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  `,
}));

interface FileItemHeaderProps {
  additions: number;
  deletions: number;
  filePath: string;
  /** Called after a successful revert so the parent can refresh the patch list. */
  onReverted?: () => void;
  /** When provided, enables the per-file revert button (unstaged mode only). */
  revertContext?: { workingDirectory: string };
  // Status reserved for future use (e.g. dim deleted entries) — keep on the
  // shape so the parent doesn't need to re-derive it later.
  status: GitFileDiffStatus;
}

export const FileItemHeader = memo<FileItemHeaderProps>(
  ({ filePath, additions, deletions, revertContext, onReverted }) => {
    const { t } = useTranslation('chat');
    const revealInFilesTab = useGlobalStore((s) => s.revealInFilesTab);

    const lastSlash = filePath.lastIndexOf('/');
    const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash + 1) : '';
    const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;

    const handleCopy = useCallback(
      async (event: MouseEvent<HTMLDivElement>) => {
        // Stop propagation so the row doesn't toggle expand on copy click.
        event.stopPropagation();
        await copyToClipboard(filePath);
        message.success(t('workingPanel.review.copied'));
      },
      [filePath, t],
    );

    const handleReveal = useCallback(
      (event: MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        revealInFilesTab(filePath);
      },
      [filePath, revealInFilesTab],
    );

    const [confirmOpen, setConfirmOpen] = useState(false);
    const [reverting, setReverting] = useState(false);

    const handleConfirmRevert = useCallback(async () => {
      if (!revertContext) return;
      setReverting(true);
      try {
        const result = await electronGitService.revertGitFile({
          filePath,
          path: revertContext.workingDirectory,
        });
        if (result.success) {
          message.success(t('workingPanel.review.revert.success', { filePath }));
          onReverted?.();
        } else {
          message.error(
            t('workingPanel.review.revert.failed', {
              error: result.error || 'unknown error',
            }),
          );
        }
      } catch (error: any) {
        message.error(
          t('workingPanel.review.revert.failed', {
            error: error?.message || String(error),
          }),
        );
      } finally {
        setReverting(false);
        setConfirmOpen(false);
      }
    }, [filePath, onReverted, revertContext, t]);

    return (
      <div className={styles.header}>
        <span className={styles.pathWrapper} title={filePath}>
          {dir && (
            // bdi keeps the dir's visual order LTR while the span is
            // direction: rtl for head-side truncation of leading segments.
            <span className={styles.dir}>
              <bdi dir={'ltr'}>{dir}</bdi>
            </span>
          )}
          <span className={styles.fileName}>{fileName}</span>
        </span>
        <span className={styles.stats}>
          {additions > 0 && <span className={styles.additions}>+{additions}</span>}
          {additions > 0 && deletions > 0 && ' '}
          {deletions > 0 && <span className={styles.deletions}>-{deletions}</span>}
        </span>
        <Flexbox horizontal align={'center'} className={styles.actions} gap={2}>
          <ActionIcon
            className={styles.rowAction}
            icon={CopyIcon}
            size={'small'}
            title={t('workingPanel.review.copyPath')}
            onClick={handleCopy}
          />
          <ActionIcon
            className={styles.rowAction}
            data-testid="reveal-in-tree"
            icon={LocateFixedIcon}
            size={'small'}
            title={t('workingPanel.review.revealInTree')}
            onClick={handleReveal}
          />
          {revertContext && (
            <Popconfirm
              arrow={false}
              cancelText={t('workingPanel.review.revert.confirm.cancel')}
              description={t('workingPanel.review.revert.confirm.description', { filePath })}
              okButtonProps={{ danger: true, loading: reverting, type: 'primary' }}
              okText={t('workingPanel.review.revert.confirm.ok')}
              open={confirmOpen}
              placement={'bottomRight'}
              title={t('workingPanel.review.revert.confirm.title')}
              onCancel={() => setConfirmOpen(false)}
              onConfirm={handleConfirmRevert}
              onOpenChange={setConfirmOpen}
            >
              <span onClick={(event) => event.stopPropagation()}>
                <ActionIcon
                  className={`${styles.rowAction} ${styles.revertDanger}`}
                  data-force-visible={confirmOpen}
                  icon={Undo2Icon}
                  size={'small'}
                  title={t('workingPanel.review.revert')}
                />
              </span>
            </Popconfirm>
          )}
        </Flexbox>
      </div>
    );
  },
);

FileItemHeader.displayName = 'ReviewFileItemHeader';

interface FileItemBodyProps {
  /** Whether the Collapse panel is expanded — gates the heavy PatchDiff render. */
  expanded: boolean;
  filePath: string;
  isBinary: boolean;
  patch: string;
  /** Inline word-level diff highlighting; off → plain line-level. */
  textDiff: boolean;
  truncated: boolean;
  viewMode: 'unified' | 'split';
  wordWrap: boolean;
}

const FileItemBody = memo<FileItemBodyProps>(
  ({ filePath, patch, isBinary, truncated, expanded, viewMode, wordWrap, textDiff }) => {
    const { t } = useTranslation('chat');

    if (!expanded) return null;

    if (isBinary) return <div className={styles.empty}>{t('workingPanel.review.binary')}</div>;
    if (truncated) return <div className={styles.empty}>{t('workingPanel.review.tooLarge')}</div>;
    if (!patch) return <div className={styles.empty}>{t('workingPanel.review.error')}</div>;

    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();

    return (
      <PatchDiff
        fileName={fileName}
        language={ext || undefined}
        patch={patch}
        showHeader={false}
        variant={'borderless'}
        viewMode={viewMode}
        diffOptions={{
          lineDiffType: textDiff ? 'word-alt' : 'none',
          overflow: wordWrap ? 'wrap' : 'scroll',
        }}
      />
    );
  },
);

FileItemBody.displayName = 'ReviewFileItemBody';

export default FileItemBody;
