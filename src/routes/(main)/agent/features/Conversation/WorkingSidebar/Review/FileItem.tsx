'use client';

import type { GitFileDiffStatus } from '@lobechat/electron-client-ipc';
import { PatchDiff } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import path from 'path-browserify-esm';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  additions: css`
    color: ${cssVar.colorSuccess};
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
    gap: 12px;
    align-items: center;

    width: 100%;
    min-width: 0;

    font-size: 12px;
  `,
  path: css`
    overflow: hidden;
    flex: 1;

    color: ${cssVar.colorText};
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
  return (
    <span className={styles.header}>
      <span className={styles.path} title={filePath}>
        {filePath}
      </span>
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
  truncated: boolean;
  viewMode: 'unified' | 'split';
}

const FileItemBody = memo<FileItemBodyProps>(
  ({ filePath, patch, isBinary, truncated, expanded, viewMode }) => {
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
      />
    );
  },
);

FileItemBody.displayName = 'ReviewFileItemBody';

export default FileItemBody;
