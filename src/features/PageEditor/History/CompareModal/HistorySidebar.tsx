'use client';

import { Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';
import type {
  DocumentHistoryListItem,
  DocumentHistorySaveSource,
} from '@/server/routers/lambda/_schema/documentHistory';

import { formatHistoryRowTime } from '../formatHistoryDate';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow-y: auto;
    flex-shrink: 0;

    width: 232px;
    padding-block: 4px 12px;
    padding-inline: 8px;
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  dot: css`
    position: absolute;
    inset-block-start: 9px;
    inset-inline-start: 5px;

    width: 8px;
    height: 8px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 999px;

    background: ${cssVar.colorBgContainer};
    box-shadow: 0 0 0 2px ${cssVar.colorBgContainer};
  `,
  dotCurrent: css`
    border-color: ${cssVar.colorSuccess};
    background: ${cssVar.colorSuccess};
  `,
  dotSelected: css`
    border-color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimary};
  `,
  group: css`
    position: relative;
  `,
  groupHeader: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    padding-block: 10px 6px;
    padding-inline-start: 24px;

    font-size: 11px;
    font-weight: 500;
    line-height: 1.2;

    background: ${cssVar.colorBgContainer};
  `,
  item: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 8px;
    border-radius: 6px;

    transition: background ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  itemCurrent: css`
    cursor: default;
  `,
  itemSelected: css`
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  source: css`
    overflow: hidden;

    margin-inline-start: auto;
    padding-inline-start: 8px;

    font-size: 11px;
    line-height: 1.3;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  meta: css`
    overflow: hidden;

    font-size: 11px;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rail: css`
    position: absolute;
    inset-block: 2px;
    inset-inline-start: 8px;

    width: 1px;

    background: ${cssVar.colorFillTertiary};
  `,
  row: css`
    position: relative;
    padding-inline-start: 24px;
  `,
  tag: css`
    height: 16px;
    padding-inline: 4px;
    font-size: 10px;
  `,
  time: css`
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
  `,
}));

interface HistoryDayGroup {
  items: DocumentHistoryListItem[];
  key: string;
  label: string;
}

const createGroups = (
  items: DocumentHistoryListItem[],
  formatLabel: (savedAt: string) => string,
): HistoryDayGroup[] => {
  const groups = new Map<string, HistoryDayGroup>();

  for (const item of items) {
    const key = dayjs(item.savedAt).format('YYYY-MM-DD');
    const group = groups.get(key);

    if (group) {
      group.items.push(item);
      continue;
    }

    groups.set(key, {
      items: [item],
      key,
      label: formatLabel(item.savedAt),
    });
  }

  return [...groups.values()];
};

interface HistorySidebarRowProps {
  isSelected: boolean;
  item: DocumentHistoryListItem;
  onSelect: (historyId: string) => void;
  saveSourceLabels: Record<DocumentHistorySaveSource, string>;
}

const HistorySidebarRow = memo<HistorySidebarRowProps>(
  ({ item, isSelected, onSelect, saveSourceLabels }) => {
    const { t } = useTranslation('file');
    const authorInfo = useAuthorInfo(item.userId);
    const disabled = item.isCurrent;

    return (
      <div className={styles.row}>
        <div
          className={cx(
            styles.dot,
            item.isCurrent && styles.dotCurrent,
            !item.isCurrent && isSelected && styles.dotSelected,
          )}
        />
        <div
          className={cx(
            styles.item,
            item.isCurrent && styles.itemCurrent,
            !item.isCurrent && isSelected && styles.itemSelected,
          )}
          onClick={() => {
            if (disabled) return;
            onSelect(item.id);
          }}
        >
          <Flexbox gap={2}>
            <Flexbox horizontal align={'center'} gap={4}>
              <Text className={styles.time}>{formatHistoryRowTime(item.savedAt)}</Text>
              {item.isCurrent && (
                <Tag className={styles.tag} variant={'borderless'}>
                  {t('pageEditor.history.current')}
                </Tag>
              )}
              <span className={styles.source}>{saveSourceLabels[item.saveSource]}</span>
            </Flexbox>
            <Text className={styles.meta} type={'secondary'}>
              {authorInfo?.fullName ? `${authorInfo.fullName} · ` : ''}
              {dayjs(item.savedAt).fromNow()}
            </Text>
          </Flexbox>
        </div>
      </div>
    );
  },
);

HistorySidebarRow.displayName = 'HistorySidebarRow';

interface HistorySidebarProps {
  items: DocumentHistoryListItem[];
  onSelect: (historyId: string) => void;
  saveSourceLabels: Record<DocumentHistorySaveSource, string>;
  selectedHistoryId: string | null;
}

const HistorySidebar = memo<HistorySidebarProps>(
  ({ items, onSelect, saveSourceLabels, selectedHistoryId }) => {
    const { t } = useTranslation('file');

    const formatLabel = useCallback(
      (savedAt: string) => {
        const d = dayjs(savedAt);
        if (d.isToday()) return t('pageEditor.history.dayLabel.today');
        if (d.isYesterday()) return t('pageEditor.history.dayLabel.yesterday');
        return d.format('MM-DD');
      },
      [t],
    );

    const groups = useMemo(() => createGroups(items, formatLabel), [formatLabel, items]);

    return (
      <div className={styles.container}>
        {groups.map((group) => (
          <Flexbox gap={0} key={group.key}>
            <div className={styles.groupHeader}>
              <Text type={'secondary'}>{group.label}</Text>
            </div>
            <div className={styles.group}>
              <div className={styles.rail} />
              {group.items.map((item) => (
                <HistorySidebarRow
                  isSelected={selectedHistoryId === item.id}
                  item={item}
                  key={item.id}
                  saveSourceLabels={saveSourceLabels}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </Flexbox>
        ))}
      </div>
    );
  },
);

HistorySidebar.displayName = 'HistorySidebar';

export default HistorySidebar;
