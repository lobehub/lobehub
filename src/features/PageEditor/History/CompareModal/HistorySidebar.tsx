'use client';

import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';
import type {
  DocumentHistoryListItem,
  DocumentHistorySaveSource,
} from '@/server/routers/lambda/_schema/documentHistory';

import { formatHistoryRowTime } from '../formatHistoryDate';

const styles = stylex.create({
  container: {
    overflowY: 'auto',
    flexShrink: 0,
    width: '232px',
    paddingBlockStart: '4px',
    paddingBlockEnd: '12px',
    paddingInline: '8px',
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  dot: {
    position: 'absolute',
    insetBlockStart: '9px',
    insetInlineStart: '5px',
    width: '8px',
    height: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '999px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    boxShadow: `0 0 0 2px ${cssVar.colorBgContainer}`,
  },
  dotCurrent: {
    borderColor: cssVar.colorSuccess,
    backgroundColor: cssVar.colorSuccess,
    backgroundImage: 'none',
  },
  dotSelected: {
    borderColor: cssVar.colorPrimary,
    backgroundColor: cssVar.colorPrimary,
    backgroundImage: 'none',
  },
  group: { position: 'relative' },
  groupHeader: {
    position: 'sticky',
    zIndex: 1,
    insetBlockStart: '0',
    paddingBlockStart: '10px',
    paddingBlockEnd: '6px',
    paddingInlineStart: '24px',
    fontSize: '11px',
    fontWeight: 500,
    lineHeight: 1.2,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  item: {
    cursor: 'pointer',
    paddingBlock: '4px',
    paddingInline: '8px',
    borderRadius: '6px',
    transition: `background ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut}`,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  itemCurrent: { cursor: 'default' },
  itemSelected: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  source: {
    overflow: 'hidden',
    marginInlineStart: 'auto',
    paddingInlineStart: '8px',
    fontSize: '11px',
    lineHeight: 1.3,
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    overflow: 'hidden',
    fontSize: '11px',
    lineHeight: 1.3,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rail: {
    position: 'absolute',
    insetBlock: '2px',
    insetInlineStart: '8px',
    width: '1px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  row: { position: 'relative', paddingInlineStart: '24px' },
  tag: { height: '16px', paddingInline: '4px', fontSize: '10px' },
  time: { fontSize: '12px', fontWeight: 600, lineHeight: 1.3 },
});

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
      <div {...stylex.props(styles.row)}>
        <div
          {...stylex.props(
            styles.dot,
            item.isCurrent && styles.dotCurrent,
            !item.isCurrent && isSelected && styles.dotSelected,
          )}
        />
        <div
          {...stylex.props(
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
              <Text className={stylex.props(styles.time).className}>
                {formatHistoryRowTime(item.savedAt)}
              </Text>
              {item.isCurrent && (
                <Tag className={stylex.props(styles.tag).className} variant={'borderless'}>
                  {t('pageEditor.history.current')}
                </Tag>
              )}
              <span {...stylex.props(styles.source)}>{saveSourceLabels[item.saveSource]}</span>
            </Flexbox>
            <Text className={stylex.props(styles.meta).className} type={'secondary'}>
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
      <div {...stylex.props(styles.container)}>
        {groups.map((group) => (
          <Flexbox gap={0} key={group.key}>
            <div {...stylex.props(styles.groupHeader)}>
              <Text type={'secondary'}>{group.label}</Text>
            </div>
            <div {...stylex.props(styles.group)}>
              <div {...stylex.props(styles.rail)} />
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
