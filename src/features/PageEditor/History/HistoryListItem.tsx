'use client';

import { ActionIcon, Flexbox, Tag } from '@lobehub/ui';
import { Tooltip } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ArrowLeftRightIcon, RotateCcwIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

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

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    pointer-events: none;

    position: absolute;
    inset-block: 50%;
    inset-inline-end: 10px;
    transform: translateY(-50%);

    display: flex;
    gap: 2px;
    align-items: center;

    opacity: 0;

    transition: opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};
  `,
  currentBadge: css`
    flex-shrink: 0;
    margin: 0;
  `,
  row: css`
    cursor: pointer;

    position: relative;

    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 16px;

    transition: background ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};

    &:hover,
    &:focus-within {
      background: ${cssVar.colorFillQuaternary};

      .history-source-tag {
        opacity: 0;
      }

      .history-actions {
        pointer-events: auto;
        opacity: 1;
      }
    }
  `,
  rowCurrent: css`
    cursor: default;

    &:hover,
    &:focus-within {
      background: transparent;

      .history-source-tag {
        opacity: 1;
      }
    }
  `,
  rowRight: css`
    position: relative;

    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;

    margin-inline-start: auto;
  `,
  rowTime: css`
    flex-shrink: 0;

    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  rowTimeCurrent: css`
    font-size: 14px;
    color: ${cssVar.colorPrimary};
  `,
  sourceTag: css`
    flex-shrink: 0;
    margin: 0;
    transition: opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};
  `,
}));

export interface HistoryListItemProps {
  historyId: string;
  onCompare: (historyId: string) => void;
  onRestore: (historyId: string) => void;
}

export const HistoryListItem = memo<HistoryListItemProps>(({ historyId, onCompare, onRestore }) => {
  const { t } = useTranslation(['common', 'file']);
  const item = useHistoryItemsStore(historyItemSelectors.itemById(historyId));
  const isRestoring = useHistoryItemsStore(historyItemSelectors.isRestoring(historyId));

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
      className={cx(styles.row, item.isCurrent && styles.rowCurrent)}
      onClick={item.isCurrent ? undefined : handleCompare}
    >
      <Tooltip title={formatHistoryAbsoluteTime(item.savedAt)}>
        <span className={cx(styles.rowTime, item.isCurrent && styles.rowTimeCurrent)}>
          {timeLabel}
        </span>
      </Tooltip>

      <div className={styles.rowRight}>
        {item.isCurrent && (
          <Tag
            className={styles.currentBadge}
            color={'processing'}
            size={'small'}
            variant={'borderless'}
          >
            {t('pageEditor.history.current', { ns: 'file' })}
          </Tag>
        )}

        {!item.isCurrent && (
          <Tag
            className={cx(styles.sourceTag, 'history-source-tag')}
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
            className={cx(styles.actions, 'history-actions')}
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
