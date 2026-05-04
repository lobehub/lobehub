'use client';

import type { GitFileDiffStatus } from '@lobechat/electron-client-ipc';
import { ActionIcon, copyToClipboard, PatchDiff } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { CopyIcon } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';

const styles = createStaticStyles(({ css, cssVar }) => ({
  additions: css`
    color: ${cssVar.colorSuccess};
  `,
  // Copy button stays hidden until the row is hovered so it doesn't add
  // visual noise to the long file list. Mirrors GitHub's "Files changed".
  copy: css`
    flex: none;
    opacity: 0;
    transition: opacity 0.15s;

    &:focus-visible {
      opacity: 1;
    }

    .ant-collapse-header:hover & {
      opacity: 1;
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
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    min-width: 0;

    font-size: 12px;
  `,
  path: css`
    /* Head-truncate so the filename (the meaningful part) stays visible
       and only leading directory segments collapse into "…". Paths are
       strongly-LTR so RTL container direction is safe here. */
    direction: rtl;
    overflow: hidden;
    flex: 1;

    min-width: 0;

    color: ${cssVar.colorText};
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  // Status reserved for future use (e.g. dim deleted entries) — keep on the
  // shape so the parent doesn't need to re-derive it later.
  status: GitFileDiffStatus;
}

export const FileItemHeader = memo<FileItemHeaderProps>(({ filePath, additions, deletions }) => {
  const { t } = useTranslation('chat');

  const handleCopy = useCallback(
    async (event: MouseEvent<HTMLDivElement>) => {
      // Stop propagation so the row doesn't toggle expand on copy click.
      event.stopPropagation();
      await copyToClipboard(filePath);
      message.success(t('workingPanel.review.copied'));
    },
    [filePath, t],
  );

  return (
    <span className={styles.header}>
      <span className={styles.path} title={filePath}>
        {/* bdi keeps the path's visual order LTR while the container is
            direction: rtl for head-side truncation. */}
        <bdi dir={'ltr'}>{filePath}</bdi>
      </span>
      <ActionIcon
        className={styles.copy}
        icon={CopyIcon}
        size={'small'}
        title={t('workingPanel.review.copyPath')}
        onClick={handleCopy}
      />
      <span className={styles.stats}>
        {additions > 0 && <span className={styles.additions}>+{additions}</span>}
        {additions > 0 && deletions > 0 && ' '}
        {deletions > 0 && <span className={styles.deletions}>-{deletions}</span>}
      </span>
    </span>
  );
});

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
