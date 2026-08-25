'use client';

import type { EditedFileEntry } from '@lobechat/builtin-tools/fileEditScan';
import {
  FilePathDisplay,
  getFileLanguage,
  getFileName,
  getFilePathDisplayInfo,
  KindDot,
  LineStats,
} from '@lobechat/shared-tool-ui/components';
import { Center, Flexbox, PatchDiff, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { ArrowUpRightIcon, ChevronDownIcon, ChevronRightIcon, FilePenLineIcon } from 'lucide-react';
import { type KeyboardEvent, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';

import { type OperationEditedFile, summarizeEditedFilesTotals } from './deriveEditedFiles';
import { useOpenEditedFile } from './useOpenEditedFile';

export const SINGLE_EDITED_FILE_ICON_SIZE = 40;
export const AGGREGATE_EDITED_FILE_ICON_SIZE = 40;

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
    border-radius: ${cssVar.borderRadiusLG};

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

    width: ${AGGREGATE_EDITED_FILE_ICON_SIZE}px;
    height: ${AGGREGATE_EDITED_FILE_ICON_SIZE}px;
    border-radius: 10px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  singleHeader: css`
    padding-block: 10px;
    padding-inline: 12px;

    &:hover [data-view-changes],
    &:focus-within [data-view-changes] {
      pointer-events: auto;
      transform: translateX(0);
      opacity: 1;
    }
  `,
  singleHeaderClickable: css`
    cursor: pointer;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  singleIcon: css`
    flex-shrink: 0;

    width: ${SINGLE_EDITED_FILE_ICON_SIZE}px;
    height: ${SINGLE_EDITED_FILE_ICON_SIZE}px;
    border-radius: 10px;

    background: ${cssVar.colorFillTertiary};
  `,
  singleTitle: css`
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
  `,
  viewChanges: css`
    pointer-events: none;

    transform: translateX(4px);

    align-self: center;

    height: 22px;
    padding: 0;

    color: ${cssVar.colorTextSecondary};

    opacity: 0;

    transition:
      opacity 150ms ease,
      transform 150ms ease;

    @media (hover: none) {
      pointer-events: auto;
      transform: translateX(0);
      opacity: 1;
    }
  `,
  viewChangesVisible: css`
    pointer-events: auto;
    transform: translateX(0);
    opacity: 1;
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

    &:hover [data-view-changes],
    &:focus-within [data-view-changes] {
      pointer-events: auto;
      transform: translateX(0);
      opacity: 1;
    }
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

const EditedFileRow = memo<{ entry: EditedFileEntry; onOpen?: () => void }>(({ entry, onOpen }) => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const hasDiff = entry.diffTexts.length > 0;
  const fileName = getFileName(entry.path);
  const language = getFileLanguage(entry.path);

  // Preview when the file's content is reachable; otherwise the row keeps its
  // legacy diff-toggle click so it never turns into a dead affordance.
  const handleRowClick = onOpen ?? (hasDiff ? () => setExpanded((prev) => !prev) : undefined);
  const clickable = !!handleRowClick;

  return (
    <Flexbox className={cx(styles.row, clickable && styles.rowClickable)}>
      <Flexbox
        horizontal
        align={'center'}
        aria-expanded={onOpen ? undefined : hasDiff ? expanded : undefined}
        className={styles.rowMain}
        gap={10}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={handleRowClick}
        onKeyDown={handleRowClick ? toggleOnKey(handleRowClick) : undefined}
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
        {onOpen && hasDiff && (
          <Button
            data-view-changes
            aria-expanded={expanded}
            className={cx(styles.viewChanges, expanded && styles.viewChangesVisible)}
            size={'small'}
            type={'text'}
            // Enter/Space on the button must not bubble into the row's own
            // key handler, which would also open the file preview.
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((prev) => !prev);
            }}
          >
            {t(expanded ? 'editedFiles.hideChanges' : 'editedFiles.viewChanges')}
          </Button>
        )}
        {!onOpen &&
          hasDiff &&
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
  entries: OperationEditedFile[];
}

export const getEditedFilesCardMode = (fileCount: number) => {
  if (fileCount === 0) return 'hidden';
  if (fileCount === 1) return 'single';
  return 'aggregate';
};

export const getEditedFileIconName = (filePath: string) => getFileName(filePath);

const SingleEditedFileCard = memo<{ entry: EditedFileEntry; onOpen?: () => void }>(
  ({ entry, onOpen }) => {
    const { t } = useTranslation('chat');
    const [showDiff, setShowDiff] = useState(false);
    const hasDiff = entry.diffTexts.length > 0;
    const fileName = getFileName(entry.path);
    const { displayPath } = getFilePathDisplayInfo(entry.path);
    const language = getFileLanguage(entry.path);

    return (
      <Flexbox className={styles.card}>
        <Flexbox
          horizontal
          align={'center'}
          className={cx(styles.singleHeader, onOpen && styles.singleHeaderClickable)}
          gap={10}
          role={onOpen ? 'button' : undefined}
          tabIndex={onOpen ? 0 : undefined}
          onClick={onOpen}
          onKeyDown={onOpen ? toggleOnKey(onOpen) : undefined}
        >
          <Center className={styles.singleIcon}>
            <FileIcon fileName={getEditedFileIconName(entry.path)} size={24} />
          </Center>
          <Flexbox flex={1} gap={2}>
            <Text ellipsis className={styles.singleTitle}>
              {t('editedFiles.singleTitle', { path: displayPath })}
            </Text>
            <LineStats
              hideZeroDeltas
              className={styles.stats}
              linesAdded={entry.linesAdded}
              linesDeleted={entry.linesDeleted}
            />
          </Flexbox>
          {hasDiff && (
            <Button
              data-view-changes
              aria-expanded={showDiff}
              className={cx(styles.viewChanges, showDiff && styles.viewChangesVisible)}
              icon={<ArrowUpRightIcon size={14} />}
              iconPosition={'end'}
              size={'small'}
              type={'text'}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                // The header itself may open the file preview — keep the diff
                // toggle from also triggering it.
                event.stopPropagation();
                setShowDiff((prev) => !prev);
              }}
            >
              {t(showDiff ? 'editedFiles.hideChanges' : 'editedFiles.viewChanges')}
            </Button>
          )}
        </Flexbox>
        {hasDiff && showDiff && (
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
  },
);
SingleEditedFileCard.displayName = 'SingleEditedFileCard';

/**
 * Codex-style aggregate card mounted at the tail of an assistant round: "edited
 * N files +x -y" with an expandable per-file list. Data is purely derived from
 * the round's tool calls (see {@link useOperationEditedFiles}) — never persisted.
 * Renders nothing when the round edited no (non-entity) files.
 */
const EditedFilesCard = memo<EditedFilesCardProps>(({ entries }) => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const getOpenAction = useOpenEditedFile();

  if (entries.length === 0) return null;
  if (entries.length === 1)
    return <SingleEditedFileCard entry={entries[0]} onOpen={getOpenAction(entries[0])} />;

  const totals = summarizeEditedFilesTotals(entries);

  return (
    <Flexbox className={styles.card}>
      <Flexbox
        horizontal
        align={'center'}
        aria-expanded={expanded}
        className={styles.header}
        gap={10}
        role={'button'}
        tabIndex={0}
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={toggleOnKey(() => setExpanded((prev) => !prev))}
      >
        <Center className={styles.headerIcon}>
          <FilePenLineIcon size={24} />
        </Center>
        <Flexbox flex={1} gap={3} style={{ minWidth: 0 }}>
          <Text ellipsis className={styles.title}>
            {t('editedFiles.title', { count: entries.length })}
          </Text>
          <LineStats
            hideZeroDeltas
            className={styles.stats}
            linesAdded={totals.linesAdded}
            linesDeleted={totals.linesDeleted}
          />
        </Flexbox>
        {expanded ? (
          <ChevronDownIcon className={styles.chevron} size={16} />
        ) : (
          <ChevronRightIcon className={styles.chevron} size={16} />
        )}
      </Flexbox>
      {expanded && (
        <Flexbox className={styles.list}>
          {entries.map((entry) => (
            <EditedFileRow entry={entry} key={entry.path} onOpen={getOpenAction(entry)} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

EditedFilesCard.displayName = 'EditedFilesCard';

export default EditedFilesCard;
