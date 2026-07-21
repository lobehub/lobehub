'use client';

import type { EditedFileEntry } from '@lobechat/builtin-tools/fileEditScan';
import {
  FilePathDisplay,
  getFileLanguage,
  getFileName,
  KindDot,
  LineStats,
} from '@lobechat/shared-tool-ui/components';
import { Flexbox, PatchDiff, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon, FilePenLineIcon } from 'lucide-react';
import { type KeyboardEvent, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { summarizeEditedFilesTotals } from './deriveEditedFiles';

/** Fire a toggle on Enter/Space so the div-based expander is keyboard operable. */
const toggleOnKey = (toggle: () => void) => (event: KeyboardEvent<HTMLDivElement>) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggle();
  }
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgElevated};
  `,
  header: css`
    cursor: pointer;
    padding-block: 10px;
    padding-inline: 12px;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  headerIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
  `,
  chevron: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
  `,
  stats: css`
    font-weight: 500;
  `,
  list: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  row: css`
    padding-block: 6px;
    padding-inline: 12px;
  `,
  rowMain: css`
    min-height: 24px;
  `,
  rowClickable: css`
    cursor: pointer;
    border-radius: 6px;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  path: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    align-items: center;

    min-width: 0;
  `,
  patch: css`
    overflow: hidden;
    margin-block-start: 6px;
    padding-inline-start: 18px;
  `,
}));

const EditedFileRow = memo<{ entry: EditedFileEntry }>(({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const hasDiff = entry.diffTexts.length > 0;
  const fileName = getFileName(entry.path);
  const language = getFileLanguage(entry.path);

  return (
    <Flexbox className={cx(styles.row, hasDiff && styles.rowClickable)}>
      <Flexbox
        horizontal
        align={'center'}
        aria-expanded={hasDiff ? expanded : undefined}
        className={styles.rowMain}
        gap={10}
        role={hasDiff ? 'button' : undefined}
        tabIndex={hasDiff ? 0 : undefined}
        onClick={hasDiff ? () => setExpanded((prev) => !prev) : undefined}
        onKeyDown={hasDiff ? toggleOnKey(() => setExpanded((prev) => !prev)) : undefined}
      >
        <KindDot kind={entry.kind} />
        <div className={styles.path}>
          <FilePathDisplay filePath={entry.path} />
        </div>
        <LineStats
          hideZeroDeltas
          className={styles.stats}
          linesAdded={entry.linesAdded}
          linesDeleted={entry.linesDeleted}
        />
        {hasDiff &&
          (expanded ? (
            <ChevronDownIcon className={styles.chevron} size={14} />
          ) : (
            <ChevronRightIcon className={styles.chevron} size={14} />
          ))}
      </Flexbox>
      {hasDiff && expanded && (
        <div className={styles.patch}>
          {entry.diffTexts.map((patch, index) => (
            <PatchDiff
              fileName={fileName}
              key={index}
              language={language}
              patch={patch}
              showHeader={false}
              variant={'borderless'}
              viewMode={'unified'}
            />
          ))}
        </div>
      )}
    </Flexbox>
  );
});
EditedFileRow.displayName = 'EditedFileRow';

interface EditedFilesCardProps {
  entries: EditedFileEntry[];
}

/**
 * Codex-style aggregate card mounted at the tail of an assistant round: "edited
 * N files +x -y" with an expandable per-file list. Data is purely derived from
 * the round's tool calls (see {@link useOperationEditedFiles}) — never persisted.
 * Renders nothing when the round edited no (non-entity) files.
 */
const EditedFilesCard = memo<EditedFilesCardProps>(({ entries }) => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  const totals = summarizeEditedFilesTotals(entries);

  return (
    <Flexbox className={styles.card}>
      <Flexbox
        horizontal
        align={'center'}
        aria-expanded={expanded}
        className={styles.header}
        gap={8}
        role={'button'}
        tabIndex={0}
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={toggleOnKey(() => setExpanded((prev) => !prev))}
      >
        {expanded ? (
          <ChevronDownIcon className={styles.chevron} size={16} />
        ) : (
          <ChevronRightIcon className={styles.chevron} size={16} />
        )}
        <FilePenLineIcon className={styles.headerIcon} size={16} />
        <Text ellipsis className={styles.title}>
          {t('editedFiles.title', { count: entries.length })}
        </Text>
        <Flexbox flex={1} />
        <LineStats
          hideZeroDeltas
          className={styles.stats}
          linesAdded={totals.linesAdded}
          linesDeleted={totals.linesDeleted}
        />
      </Flexbox>
      {expanded && (
        <Flexbox className={styles.list}>
          {entries.map((entry) => (
            <EditedFileRow entry={entry} key={entry.path} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

EditedFilesCard.displayName = 'EditedFilesCard';

export default EditedFilesCard;
