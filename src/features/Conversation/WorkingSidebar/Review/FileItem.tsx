'use client';

import type { GitFileDiffStatus } from '@lobechat/electron-client-ipc';
import { nanoid } from '@lobechat/utils';
import {
  ActionIcon,
  confirmModal,
  copyToClipboard,
  cssVar as themeCssVar,
  Flexbox,
  PatchDiff,
  Skeleton,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CopyIcon, LocateFixedIcon, Undo2Icon } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo, type MouseEvent, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { gitService } from '@/services/git';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';

import type { ComposerTarget } from '../../types';
import type { DiffSelectedLineRange } from './selection';
import { buildCodeContextSelection } from './selection';

const styles = stylex.create({
  additions: { color: cssVar.colorSuccess },
  // Hover-revealed row actions, anchored to the right edge with a gradient
  // mask that fades in from transparent → row hover-bg so any path/stats
  // text behind the icons softly disappears instead of being abruptly
  // overlapped. The row (FileRow) is the hover marker.
  actions: {
    pointerEvents: { default: 'none', [stylex.when.ancestor(':hover')]: 'auto' },
    position: 'absolute',
    insetBlock: 0,
    insetInlineEnd: '-8px',
    alignItems: 'center',
    paddingInlineStart: '28px',
    paddingInlineEnd: 0,
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    backgroundImage: `linear-gradient(to right, transparent 0, ${cssVar.colorFillTertiary} 28px), linear-gradient(to right, transparent 0, ${cssVar.colorBgContainer} 28px)`,
    transition: 'opacity 0.15s',
  },
  rowAction: { flex: 'none', color: cssVar.colorTextTertiary },
  // Composed after `rowAction`: a conditional value replaces the whole property,
  // so the resting colour is restated here.
  revertDanger: { color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorError } },
  deletions: { color: cssVar.colorError },
  pending: { paddingBlock: '8px', paddingInline: '12px' },
  empty: {
    paddingBlock: '12px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  dir: {
    direction: 'rtl',
    // Only the directory portion shrinks + head-truncates. Short dirs
    // sit naturally next to the filename (no awkward right-alignment);
    // long dirs collapse leading segments into "…" via the RTL trick.
    overflow: 'hidden',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    minWidth: 0,
    color: cssVar.colorTextTertiary,
    textAlign: 'start',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileName: { flex: 'none', color: cssVar.colorText, whiteSpace: 'nowrap' },
  header: {
    position: 'relative',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    width: '100%',
    minWidth: 0,
    fontSize: '12px',
  },
  pathWrapper: {
    overflow: 'hidden',
    // Shrink-only (no grow): short paths stay content-sized so stats sit
    // right after the filename; long paths still shrink so the dir part
    // can head-truncate.
    display: 'flex',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    minWidth: 0,
  },
  stats: {
    flex: 'none',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
  },
});

const reviewDiffUnsafeCSS = `
  :host {
    --diffs-dark-bg: transparent !important;
    --diffs-light-bg: transparent !important;
    --diffs-gap-fallback: 8px;
    --diffs-added-light: ${themeCssVar.colorSuccessHover};
    --diffs-added-dark: ${themeCssVar.colorSuccessBorderHover};
    --diffs-modified-light: ${themeCssVar.colorInfoHover};
    --diffs-modified-dark: ${themeCssVar.colorInfoBorderHover};
    --diffs-deleted-light: ${themeCssVar.colorErrorHover};
    --diffs-deleted-dark: ${themeCssVar.colorErrorBorderHover};
  }

  [data-gutter-buffer] {
    opacity: 0.2 !important;
  }

  [data-code] {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }

  [data-gutter] {
    backdrop-filter: blur(16px) !important;
  }

  [data-gutter-utility-slot] [data-utility-button] {
    width: 18px !important;
    min-width: 18px !important;
    height: 18px !important;
    margin-right: calc(1ch - 8px) !important;
    border: 1px solid #0969da !important;
    border-radius: 4px !important;
    background: #0969da !important;
    background-color: #0969da !important;
    color: #fff !important;
    fill: currentColor !important;
    box-shadow: 0 1px 3px ${themeCssVar.colorFillSecondary} !important;
  }

  [data-gutter-utility-slot] [data-utility-button]:is(:hover, :focus-visible, :active) {
    border-color: #0860ca !important;
    background: #0860ca !important;
    background-color: #0860ca !important;
    color: #fff !important;
    fill: currentColor !important;
  }

  [data-gutter-utility-slot] [data-utility-button] [data-icon] {
    width: 10px !important;
    height: 10px !important;
  }
`;

interface FileItemHeaderProps {
  additions: number;
  deletions: number;
  filePath: string;
  /** Hide the leading directory portion — used in tree layout where the
   * containing folders are already shown by the tree, so the row only needs
   * the bare filename. */
  hideDir?: boolean;
  /** Called after a successful revert so the parent can refresh the patch list. */
  onReverted?: () => void;
  /** When provided, enables the per-file revert button (unstaged mode only). */
  revertContext?: { deviceId?: string; workingDirectory: string };
  /** Keep the revert button visible but inert, e.g. while the row is a
   * persisted summary the live read has not confirmed yet. */
  revertDisabled?: boolean;
  // Status reserved for future use (e.g. dim deleted entries) — keep on the
  // shape so the parent doesn't need to re-derive it later.
  status: GitFileDiffStatus;
}

export const FileItemHeader = memo<FileItemHeaderProps>(
  ({ filePath, additions, deletions, hideDir, revertContext, revertDisabled, onReverted }) => {
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
        toast.success(t('workingPanel.review.copied'));
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

    const handleRevert = useCallback(
      (event: MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (!revertContext || revertDisabled) return;
        confirmModal({
          cancelText: t('workingPanel.review.revert.confirm.cancel'),
          content: t('workingPanel.review.revert.confirm.description'),
          okButtonProps: { danger: true },
          okText: t('workingPanel.review.revert.confirm.ok'),
          onOk: async () => {
            try {
              const result = await gitService.revertGitFile({
                deviceId: revertContext.deviceId,
                filePath,
                path: revertContext.workingDirectory,
              });
              if (result.success) {
                toast.success(t('workingPanel.review.revert.success', { fileName }));
                onReverted?.();
              } else {
                toast.error(
                  t('workingPanel.review.revert.failed', {
                    error: result.error || 'unknown error',
                  }),
                );
              }
            } catch (error: any) {
              toast.error(
                t('workingPanel.review.revert.failed', {
                  error: error?.message || String(error),
                }),
              );
            }
          },
          title: t('workingPanel.review.revert.confirm.title'),
        });
      },
      [fileName, filePath, onReverted, revertContext, revertDisabled, t],
    );

    return (
      <div {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.pathWrapper)} title={filePath}>
          {!hideDir && dir && (
            // bdi keeps the dir's visual order LTR while the span is
            // direction: rtl for head-side truncation of leading segments.
            <span {...stylex.props(styles.dir)}>
              <bdi dir={'ltr'}>{dir}</bdi>
            </span>
          )}
          <span {...stylex.props(styles.fileName)}>{fileName}</span>
        </span>
        <span {...stylex.props(styles.stats)}>
          {additions > 0 && <span {...stylex.props(styles.additions)}>+{additions}</span>}
          {additions > 0 && deletions > 0 && ' '}
          {deletions > 0 && <span {...stylex.props(styles.deletions)}>-{deletions}</span>}
        </span>
        <Flexbox horizontal align={'center'} {...stylex.props(styles.actions)} gap={2}>
          <ActionIcon
            {...stylex.props(styles.rowAction)}
            icon={CopyIcon}
            size={'small'}
            title={t('workingPanel.review.copyPath')}
            onClick={handleCopy}
          />
          <ActionIcon
            {...stylex.props(styles.rowAction)}
            data-testid="reveal-in-tree"
            icon={LocateFixedIcon}
            size={'small'}
            title={t('workingPanel.review.revealInTree')}
            onClick={handleReveal}
          />
          {revertContext && (
            <ActionIcon
              {...stylex.props(styles.rowAction, styles.revertDanger)}
              data-testid="revert-file"
              disabled={revertDisabled}
              icon={Undo2Icon}
              size={'small'}
              title={t('workingPanel.review.revert')}
              onClick={handleRevert}
            />
          )}
        </Flexbox>
      </div>
    );
  },
);

FileItemHeader.displayName = 'ReviewFileItemHeader';

interface FileItemBodyProps {
  composerTarget: ComposerTarget;
  /** Whether the Collapse panel is expanded — gates the heavy PatchDiff render. */
  expanded: boolean;
  filePath: string;
  isBinary: boolean;
  patch: string;
  /** Diff text not loaded yet — show a placeholder instead of the error line. */
  pending?: boolean;
  /** Inline word-level diff highlighting; off → plain line-level. */
  textDiff: boolean;
  truncated: boolean;
  viewMode: 'unified' | 'split';
  wordWrap: boolean;
  workingDirectory: string;
}

const FileItemBody = memo<FileItemBodyProps>(
  ({
    composerTarget,
    filePath,
    patch,
    pending,
    isBinary,
    truncated,
    expanded,
    viewMode,
    workingDirectory,
    wordWrap,
    textDiff,
  }) => {
    const { t } = useTranslation('chat');
    const addChatContextSelection = useFileStore((s) => s.addChatContextSelection);
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const language = ext || undefined;

    const diffOptions = useMemo(
      () => ({
        enableGutterUtility: composerTarget.writable,
        enableLineSelection: true,
        lineDiffType: textDiff ? ('word-alt' as const) : ('none' as const),
        onGutterUtilityClick: (range: DiffSelectedLineRange) => {
          if (!composerTarget.writable) return;

          const selection = buildCodeContextSelection({
            filePath,
            language,
            patch,
            range,
            workingDirectory,
          });

          if (!selection) return;

          addChatContextSelection({
            contextKey: composerTarget.contextKey,
            selection: {
              ...selection,
              id: `code-selection-${nanoid(6)}`,
              type: 'text',
            },
          });
          toast.success(t('workingPanel.review.addSelectionToContext.success'));
        },
        overflow: wordWrap ? ('wrap' as const) : ('scroll' as const),
        unsafeCSS: reviewDiffUnsafeCSS,
      }),
      [
        addChatContextSelection,
        composerTarget,
        filePath,
        language,
        patch,
        t,
        textDiff,
        wordWrap,
        workingDirectory,
      ],
    );

    if (!expanded) return null;

    if (isBinary)
      return <div {...stylex.props(styles.empty)}>{t('workingPanel.review.binary')}</div>;
    if (truncated)
      return <div {...stylex.props(styles.empty)}>{t('workingPanel.review.tooLarge')}</div>;
    if (!patch && pending)
      return (
        <div aria-busy {...stylex.props(styles.pending)} data-testid={'review-diff-pending'}>
          <Skeleton.Text rows={3} width={['80%', '60%', '70%']} />
        </div>
      );
    if (!patch) return <div {...stylex.props(styles.empty)}>{t('workingPanel.review.error')}</div>;

    return (
      <PatchDiff
        diffOptions={diffOptions}
        fileName={fileName}
        language={language}
        patch={patch}
        showHeader={false}
        style={{ borderRadius: 0 }}
        variant={'borderless'}
        viewMode={viewMode}
      />
    );
  },
);

FileItemBody.displayName = 'ReviewFileItemBody';

export default FileItemBody;
