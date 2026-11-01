'use client';

import type { EditedFileEntry } from '@lobechat/builtin-tools/fileEditScan';
import type { OperationEditedFile } from '@lobechat/builtin-tools/operationArtifacts';
import {
  FilePathDisplay,
  getFileLanguage,
  getFileName,
  getFilePathDisplayInfo,
  KindDot,
  LineStats,
} from '@lobechat/shared-tool-ui/components';
import { Button, Center, Flexbox, PatchDiff, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

import { summarizeEditedFilesTotals } from './deriveEditedFiles';
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

const styles = stylex.create({
  card: {
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  header: {
    paddingBlock: '8px',
    paddingInline: '12px',
  },
  headerIcon: {
    flexShrink: 0,
    width: `${AGGREGATE_EDITED_FILE_ICON_SIZE}px`,
    height: `${AGGREGATE_EDITED_FILE_ICON_SIZE}px`,
    borderRadius: '8px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  singleHeader: {
    position: 'relative',
    paddingBlock: '8px',
    paddingInline: '12px',
  },
  singleHeaderClickable: {
    cursor: 'pointer',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  singleTitle: {
    minWidth: '0',
    fontSize: '14px',
    fontWeight: 500,
  },
  /**
   * The action slides *over* the line stats instead of displacing them, so the
   * `+N -M` column stays put on hover. The two stacked gradients composite to
   * exactly the hovered row colour (fill over elevated), which is why the
   * opaque end shows no seam against the row behind it.
   */
  viewChanges: {
    position: 'absolute',
    insetBlockStart: 0,
    insetBlockEnd: 0,
    insetInlineEnd: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingInlineStart: '56px',
    paddingInlineEnd: '12px',
    pointerEvents: {
      'default': 'none',
      [stylex.when.ancestor(':hover')]: 'auto',
      [stylex.when.ancestor(':focus-within')]: 'auto',
      '@media (hover: none)': 'auto',
    },
    transform: {
      default: null,
      [stylex.when.ancestor(':hover')]: 'translateX(0)',
      [stylex.when.ancestor(':focus-within')]: 'translateX(0)',
    },
    opacity: {
      'default': 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
      '@media (hover: none)': 1,
    },
    backgroundImage: `linear-gradient(to left, ${cssVar.colorFillQuaternary} 62%, transparent), linear-gradient(to left, ${cssVar.colorBgElevated} 62%, transparent)`,
    transition: `opacity 160ms ${cssVar.motionEaseOut}`,
  },
  viewChangesButton: {
    height: '22px',
    padding: '0',
    color: cssVar.colorTextSecondary,
  },
  viewChangesVisible: {
    pointerEvents: 'auto',
    opacity: 1,
  },
  chevron: {
    flexShrink: 0,
    color: cssVar.colorTextTertiary,
  },
  title: {
    minWidth: '0',
    fontSize: '14px',
    fontWeight: 500,
  },
  stats: {
    fontWeight: 500,
  },
  list: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  showMore: {
    cursor: 'pointer',
    paddingBlock: '7px',
    paddingInline: '12px',
    fontSize: '13px',
    color: cssVar.colorTextSecondary,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  row: {
    position: 'relative',
    paddingBlock: '6px',
    paddingInline: '12px',
  },
  rowMain: {
    minHeight: '24px',
  },
  rowClickable: {
    cursor: 'pointer',
    borderRadius: '6px',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  path: {
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    alignItems: 'center',
    minWidth: '0',
  },
  patch: {
    overflow: 'hidden',
    marginBlockStart: '6px',
    paddingInlineStart: '18px',
  },
});

const marker = stylex.defaultMarker();

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
    <Flexbox
      className={stylex.props(styles.row, clickable && styles.rowClickable, marker).className}
    >
      <Flexbox
        horizontal
        align={'center'}
        aria-expanded={onOpen ? undefined : hasDiff ? expanded : undefined}
        className={stylex.props(styles.rowMain).className}
        gap={10}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={handleRowClick}
        onKeyDown={handleRowClick ? toggleOnKey(handleRowClick) : undefined}
      >
        <KindDot kind={entry.kind} />
        <div {...stylex.props(styles.path)}>
          <FilePathDisplay filePath={entry.path} />
        </div>
        <LineStats
          hideZeroDeltas
          className={stylex.props(styles.stats).className}
          linesAdded={entry.linesAdded}
          linesDeleted={entry.linesDeleted}
        />
        {onOpen && hasDiff && (
          <div
            data-view-changes
            {...stylex.props(styles.viewChanges, expanded && styles.viewChangesVisible)}
          >
            <Button
              aria-expanded={expanded}
              className={stylex.props(styles.viewChangesButton).className}
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
            <ChevronDownIcon className={stylex.props(styles.chevron).className} size={14} />
          ) : (
            <ChevronRightIcon className={stylex.props(styles.chevron).className} size={14} />
          ))}
      </Flexbox>
      {hasDiff && expanded && (
        <div {...stylex.props(styles.patch)}>
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
    // Same fallback as a list row: a file nothing can read back (e.g. written
    // outside the working directory) still opens its diff snapshot, and one
    // with neither says so instead of swallowing the click.
    const handleClick = onOpen ?? (hasDiff ? () => setShowDiff((prev) => !prev) : undefined);

    return (
      <Flexbox className={stylex.props(styles.card).className}>
        <Flexbox
          horizontal
          align={'center'}
          aria-expanded={onOpen ? undefined : hasDiff ? showDiff : undefined}
          gap={10}
          role={handleClick ? 'button' : undefined}
          tabIndex={handleClick ? 0 : undefined}
          className={
            stylex.props(styles.singleHeader, handleClick && styles.singleHeaderClickable, marker)
              .className
          }
          onClick={handleClick}
          onKeyDown={handleClick ? toggleOnKey(handleClick) : undefined}
        >
          <FileIcon
            fileName={getEditedFileIconName(entry.path)}
            size={SINGLE_EDITED_FILE_ICON_SIZE}
          />
          <Flexbox flex={1} gap={2}>
            <Text ellipsis className={stylex.props(styles.singleTitle).className}>
              {t('editedFiles.singleTitle', { path: displayPath })}
            </Text>
            <LineStats
              hideZeroDeltas
              className={stylex.props(styles.stats).className}
              linesAdded={entry.linesAdded}
              linesDeleted={entry.linesDeleted}
            />
          </Flexbox>
          {!handleClick && (
            <Text fontSize={12} type={'secondary'}>
              {t('editedFiles.previewUnavailable')}
            </Text>
          )}
          {hasDiff && (
            <div
              data-view-changes
              {...stylex.props(styles.viewChanges, showDiff && styles.viewChangesVisible)}
            >
              <Button
                aria-expanded={showDiff}
                className={stylex.props(styles.viewChangesButton).className}
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
          <div {...stylex.props(styles.patch)}>
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
    <Flexbox className={stylex.props(styles.card).className}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={10}
      >
        <Center className={stylex.props(styles.headerIcon).className}>
          <FilePenLineIcon size={20} />
        </Center>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text ellipsis className={stylex.props(styles.title).className}>
            {t('editedFiles.title', { count: entries.length })}
          </Text>
          <LineStats
            hideZeroDeltas
            className={stylex.props(styles.stats).className}
            linesAdded={totals.linesAdded}
            linesDeleted={totals.linesDeleted}
          />
        </Flexbox>
      </Flexbox>
      <Flexbox className={stylex.props(styles.list).className}>
        {visible.map((entry) => (
          <EditedFileRow entry={entry} key={entry.path} onOpen={getOpenAction(entry)} />
        ))}
        {hiddenCount > 0 && (
          <Flexbox
            horizontal
            align={'center'}
            aria-expanded={showAll}
            className={stylex.props(styles.showMore).className}
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
              <ChevronUpIcon className={stylex.props(styles.chevron).className} size={14} />
            ) : (
              <ChevronDownIcon className={stylex.props(styles.chevron).className} size={14} />
            )}
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
});

EditedFilesCard.displayName = 'EditedFilesCard';

export default EditedFilesCard;
