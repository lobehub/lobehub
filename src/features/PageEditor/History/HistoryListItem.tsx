'use client';

import { ActionIcon, Flexbox, Tag, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { ArrowLeftRightIcon, RotateCcwIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';
import { useEventCallback } from '@/hooks/useEventCallback';
import type { DocumentHistorySaveSource } from '@/server/routers/lambda/_schema/documentHistory';

import { formatHistoryAbsoluteTime, formatHistoryRowTime } from './formatHistoryDate';
import { historyItemSelectors, useHistoryItemsStore } from './HistoryItemsProvider';

type TagColor = 'default' | 'success' | 'purple' | 'geekblue' | 'gold' | 'processing';

const SOURCE_TAG_COLOR: Record<DocumentHistorySaveSource, TagColor> = {
  autosave: 'default',
  llm_call: 'purple',
  manual: 'success',
  restore: 'geekblue',
  system: 'gold',
};

const styles = stylex.create({
  description: {
    overflow: 'hidden',
    fontSize: '12px',
    lineHeight: 1.2,
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowMain: { overflow: 'hidden', flex: '1', minWidth: 0 },
  // Revealed by the hovered / focused row (the row is the marker).
  actions: {
    pointerEvents: {
      default: 'none',
      [stylex.when.ancestor(':hover')]: 'auto',
      [stylex.when.ancestor(':focus-within')]: 'auto',
    },
    position: 'absolute',
    insetBlock: '50%',
    insetInlineEnd: '10px',
    transform: 'translateY(-50%)',
    display: 'flex',
    gap: '2px',
    alignItems: 'center',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
    },
    transition: `opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut}`,
  },
  currentBadge: { flexShrink: 0, margin: 0 },
  row: {
    cursor: 'pointer',
    position: 'relative',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '8px',
    paddingInline: '16px',
    transition: `background ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut}`,
    backgroundColor: {
      'default': null,
      ':hover': cssVar.colorFillQuaternary,
      ':focus-within': cssVar.colorFillQuaternary,
    },
    backgroundImage: 'none',
  },
  rowCurrent: {
    cursor: 'default',
    backgroundColor: 'transparent',
  },
  rowRight: {
    position: 'relative',
    display: 'flex',
    flexShrink: 0,
    gap: '8px',
    alignItems: 'center',
    marginInlineStart: 'auto',
  },
  rowTime: {
    flexShrink: 0,
    fontSize: '13px',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
    color: cssVar.colorText,
  },
  rowTimeCurrent: { fontSize: '14px', color: cssVar.colorPrimary },
  // The source tag steps aside for the row's actions on hover / focus.
  sourceTag: {
    flexShrink: 0,
    margin: 0,
    opacity: {
      default: 1,
      [stylex.when.ancestor(':hover')]: 0,
      [stylex.when.ancestor(':focus-within')]: 0,
    },
    transition: `opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut}`,
  },
});

export interface HistoryListItemProps {
  historyId: string;
  onCompare: (historyId: string) => void;
  onRestore: (historyId: string) => void;
}

export const HistoryListItem = memo<HistoryListItemProps>(({ historyId, onCompare, onRestore }) => {
  const { t } = useTranslation(['common', 'file']);
  const item = useHistoryItemsStore(historyItemSelectors.itemById(historyId));
  const isRestoring = useHistoryItemsStore(historyItemSelectors.isRestoring(historyId));
  const authorInfo = useAuthorInfo(item?.userId);

  const handleCompare = useEventCallback(() => {
    onCompare(historyId);
  });

  const handleRestore = useEventCallback(() => {
    onRestore(historyId);
  });

  const handleStopPropagation = useEventCallback((event: MouseEvent) => {
    event.stopPropagation();
  });

  if (!item) return null;

  const timeLabel = formatHistoryRowTime(item.savedAt);
  const saveSourceLabel = t(`pageEditor.history.saveSource.${item.saveSource}`, { ns: 'file' });

  return (
    <div
      {...stylex.props(styles.row, item.isCurrent && styles.rowCurrent, stylex.defaultMarker())}
      onClick={item.isCurrent ? undefined : handleCompare}
    >
      <Flexbox align={'flex-start'} className={stylex.props(styles.rowMain).className} gap={4}>
        <Tooltip title={formatHistoryAbsoluteTime(item.savedAt)}>
          <span {...stylex.props(styles.rowTime, item.isCurrent && styles.rowTimeCurrent)}>
            {timeLabel}
          </span>
        </Tooltip>
        <span {...stylex.props(styles.description)}>
          {authorInfo?.fullName ? `${authorInfo.fullName} · ` : ''}
          {dayjs(item.savedAt).fromNow()}
        </span>
      </Flexbox>

      <div {...stylex.props(styles.rowRight)}>
        {item.isCurrent && (
          <Tag
            className={stylex.props(styles.currentBadge).className}
            color={'processing'}
            size={'small'}
            variant={'borderless'}
          >
            {t('pageEditor.history.current', { ns: 'file' })}
          </Tag>
        )}

        {!item.isCurrent && (
          <Tag
            className={stylex.props(styles.sourceTag).className}
            color={SOURCE_TAG_COLOR[item.saveSource]}
            size={'small'}
            variant={'borderless'}
          >
            {saveSourceLabel}
          </Tag>
        )}
        {!item.isCurrent && (
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.actions).className}
            gap={2}
            onClick={handleStopPropagation}
          >
            <ActionIcon
              icon={ArrowLeftRightIcon}
              size={{ blockSize: 26, borderRadius: '50%', size: 14 }}
              title={t('pageEditor.history.compare', { ns: 'file' })}
              onClick={handleCompare}
            />
            <ActionIcon
              icon={RotateCcwIcon}
              loading={isRestoring}
              size={{ blockSize: 26, borderRadius: '50%', size: 14 }}
              title={t('pageEditor.history.restore', { ns: 'file' })}
              onClick={handleRestore}
            />
          </Flexbox>
        )}
      </div>
    </div>
  );
});

HistoryListItem.displayName = 'HistoryListItem';
