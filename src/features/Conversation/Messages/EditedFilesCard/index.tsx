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
import { Center, Flexbox, PatchDiff } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  FilePenLineIcon,
} from 'lucide-react';
import { type KeyboardEvent, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';

import { type OperationEditedFile, summarizeEditedFilesTotals } from './deriveEditedFiles';
import { useOpenEditedFile } from './useOpenEditedFile';

export const SINGLE_EDITED_FILE_ICON_SIZE = 40;
export const AGGREGATE_EDITED_FILE_ICON_SIZE = 40;

/** Files listed before the "show N more" row, matching Codex's file toolbar. */
export const INITIAL_VISIBLE_EDITED_FILES = 3;

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
    padding-block: 8px;
    padding-inline: 12px;
  `,
  headerIcon: css`
    flex-shrink: 0;

    width: ${AGGREGATE_EDITED_FILE_ICON_SIZE}px;
    height: ${AGGREGATE_EDITED_FILE_ICON_SIZE}px;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  singleHeader: css`
    position: relative;
    padding-block: 8px;
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
  singleTitle: css`
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
  `,
  /**
   * The action slides *over* the line stats instead of displacing them, so the
   * `+N -M` column stays put on hover. The two stacked gradients composite to
   * exactly the hovered row colour (fill over elevated), which is why the
   * opaque end shows no seam against the row behind it.
   */
  viewChanges: css`
    pointer-events: none;

    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;

    display: flex;
    align-items: center;
    justify-content: flex-end;

    padding-inline: 56px 12px;

    opacity: 0;
    background:
      linear-gradient(to left, ${cssVar.colorFillQuaternary} 62%, transparent),
      linear-gradient(to left, ${cssVar.colorBgElevated} 62%, transparent);

    transition: opacity 160ms ${cssVar.motionEaseOut};

    @media (hover: none) {
      pointer-events: auto;
      opacity: 1;
    }
  `,
  viewChangesButton: css`
    height: 22px;
    padding: 0;
    color: ${cssVar.colorTextSecondary};
  `,
  viewChangesVisible: css`
    pointer-events: auto;
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
  showMore: css`
    cursor: pointer;

    padding-block: 7px;
    padding-inline: 12px;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  row: css`
    position: relative;
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
          <div
            data-view-changes
            className={cx(styles.viewChanges, expanded && styles.viewChangesVisible)}
          >
            <Button
              aria-expanded={expanded}
              className={styles.viewChangesButton}
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
          </div>
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
          <FileIcon
            fileName={getEditedFileIconName(entry.path)}
            size={SINGLE_EDITED_FILE_ICON_SIZE}
          />
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
            <div
              data-view-changes
              className={cx(styles.viewChanges, showDiff && styles.viewChangesVisible)}
            >
              <Button
                aria-expanded={showDiff}
                className={styles.viewChangesButton}
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
            </div>
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
  const [showAll, setShowAll] = useState(false);
  const getOpenAction = useOpenEditedFile();

  if (entries.length === 0) return null;
  if (entries.length === 1)
    return <SingleEditedFileCard entry={entries[0]} onOpen={getOpenAction(entries[0])} />;

  const totals = summarizeEditedFilesTotals(entries);
  // The edited-file set is the round's *result*, not one of its steps — it opens
  // with the first few files already listed and defers only the long tail.
  const hiddenCount = entries.length - INITIAL_VISIBLE_EDITED_FILES;
  const visible = showAll ? entries : entries.slice(0, INITIAL_VISIBLE_EDITED_FILES);
  const toggleShowAll = () => setShowAll((prev) => !prev);

  return (
    <Flexbox className={styles.card}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={10}>
        <Center className={styles.headerIcon}>
          <FilePenLineIcon size={20} />
        </Center>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
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
      </Flexbox>
      <Flexbox className={styles.list}>
        {visible.map((entry) => (
          <EditedFileRow entry={entry} key={entry.path} onOpen={getOpenAction(entry)} />
        ))}
        {hiddenCount > 0 && (
          <Flexbox
            horizontal
            align={'center'}
            aria-expanded={showAll}
            className={styles.showMore}
            gap={6}
            role={'button'}
            tabIndex={0}
            onClick={toggleShowAll}
            onKeyDown={toggleOnKey(toggleShowAll)}
          >
            {showAll
              ? t('editedFiles.showLess')
              : t('editedFiles.showMore', { count: hiddenCount })}
            {showAll ? (
              <ChevronUpIcon className={styles.chevron} size={14} />
            ) : (
              <ChevronDownIcon className={styles.chevron} size={14} />
            )}
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
});

EditedFilesCard.displayName = 'EditedFilesCard';

export default EditedFilesCard;
