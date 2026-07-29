'use client';

import {
  ActionIcon,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { confirmModal, Tabs } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  Archive,
  CalendarRange,
  ChevronDown,
  FolderClosed,
  LayoutGrid,
  List as ListIcon,
  ListFilter,
  ListTodoIcon,
  type LucideIcon,
  MessageCircle,
  MoreHorizontal,
  Plus,
  TestTubeIcon,
  Webhook,
  X,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useTopicsViewStore } from './store';
import type { GroupBy, SortBy, StatusFilter, TimeRangeFilter, TriggerFilter } from './types';

const CONTROL_HEIGHT = 32;
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

const styles = createStaticStyles(({ css }) => ({
  addPill: css`
    cursor: pointer;
    user-select: none;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    height: ${CONTROL_HEIGHT}px;
    padding-inline: 12px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${CONTROL_HEIGHT / 2}px;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    transition: all 0.15s;

    &:hover {
      border-color: ${cssVar.colorPrimary};
      color: ${cssVar.colorText};
    }
  `,
  chip: css`
    display: inline-flex;
    align-items: stretch;

    height: ${CONTROL_HEIGHT}px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${CONTROL_HEIGHT / 2}px;

    background: ${cssVar.colorFillTertiary};

    transition: border-color 0.15s;

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  chipClose: css`
    all: unset;

    cursor: pointer;

    display: inline-flex;
    align-items: center;

    padding-inline: 8px 12px;
    border-start-end-radius: ${CONTROL_HEIGHT / 2}px;
    border-end-end-radius: ${CONTROL_HEIGHT / 2}px;

    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  chipMain: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    padding-block: 0;
    padding-inline: 12px 6px;

    font-size: 13px;
    color: ${cssVar.colorText};
  `,
  chipValue: css`
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  divider: css`
    width: 1px;
    height: 16px;
    margin-inline: 4px;
    background: ${cssVar.colorBorderSecondary};
  `,
  sortPill: css`
    cursor: pointer;
    user-select: none;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    height: ${CONTROL_HEIGHT}px;
    padding-inline: 12px;
    border-radius: ${CONTROL_HEIGHT / 2}px;

    font-size: 13px;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

const STATUS_OPTIONS: { key: StatusFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'management.filters.status.all' },
  { key: 'active', labelKey: 'management.filters.status.active' },
  { key: 'running', labelKey: 'management.filters.status.running' },
  { key: 'completed', labelKey: 'management.filters.status.completed' },
];

const TRIGGER_OPTIONS: TriggerFilter[] = ['chat', 'api', 'task', 'eval'];

const TRIGGER_ICON: Record<TriggerFilter, LucideIcon> = {
  api: Webhook,
  chat: MessageCircle,
  eval: TestTubeIcon,
  task: ListTodoIcon,
};

const TIME_OPTIONS: TimeRangeFilter[] = ['all', 'today', 'week', 'month'];

const SORT_OPTIONS: SortBy[] = ['updatedAt', 'createdAt', 'title'];

const GROUP_OPTIONS: GroupBy[] = ['byTime', 'byProject', 'none'];

interface ToolbarProps {
  projects: { label: string; value: string }[];
  statusCounts: Record<StatusFilter, number>;
}

const CheckMark = ({ visible }: { visible: boolean }) => (
  <span style={{ display: 'inline-block', width: 12 }}>{visible ? '✓' : ''}</span>
);

interface FilterChipProps {
  icon?: LucideIcon;
  items: DropdownItem[];
  label: string;
  onClear: () => void;
  value: ReactNode;
}

const FilterChip = memo<FilterChipProps>(({ icon, label, value, items, onClear }) => {
  return (
    <span className={styles.chip}>
      <DropdownMenu items={items}>
        <span className={styles.chipMain}>
          {icon && <Icon icon={icon} size={12} />}
          <Text style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>{label}:</Text>
          <span className={styles.chipValue}>{value}</span>
          <Icon icon={ChevronDown} size={10} />
        </span>
      </DropdownMenu>
      <button
        aria-label={`Clear ${label}`}
        className={styles.chipClose}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
      >
        <Icon icon={X} size={12} />
      </button>
    </span>
  );
});

const Toolbar = memo<ToolbarProps>(({ projects, statusCounts }) => {
  const { t } = useTranslation('topic');
  const { message } = App.useApp();

  const topics = useChatStore(topicSelectors.agentTopicsViewTopics);
  const updateTopicStatus = useChatStore((s) => s.updateTopicStatus);

  const status = useTopicsViewStore((s) => s.status);
  const setStatus = useTopicsViewStore((s) => s.setStatus);
  const groupIds = useTopicsViewStore((s) => s.groupIds);
  const setGroupIds = useTopicsViewStore((s) => s.setGroupIds);
  const triggers = useTopicsViewStore((s) => s.triggers);
  const setTriggers = useTopicsViewStore((s) => s.setTriggers);
  const timeRange = useTopicsViewStore((s) => s.timeRange);
  const setTimeRange = useTopicsViewStore((s) => s.setTimeRange);
  const sortBy = useTopicsViewStore((s) => s.sortBy);
  const setSortBy = useTopicsViewStore((s) => s.setSortBy);
  const groupBy = useTopicsViewStore((s) => s.groupBy);
  const setGroupBy = useTopicsViewStore((s) => s.setGroupBy);
  const viewMode = useTopicsViewStore((s) => s.viewMode);
  const setViewMode = useTopicsViewStore((s) => s.setViewMode);

  const triggerItems: DropdownItem[] = useMemo(
    () =>
      TRIGGER_OPTIONS.map((tr) => ({
        extra: <CheckMark visible={triggers.includes(tr)} />,
        icon: <Icon icon={TRIGGER_ICON[tr]} size={14} />,
        key: tr,
        label: t(`management.filters.trigger.${tr}` as any) as string,
        onClick: () =>
          setTriggers(triggers.includes(tr) ? triggers.filter((x) => x !== tr) : [...triggers, tr]),
      })),
    [triggers, t, setTriggers],
  );

  const projectItems: DropdownItem[] = useMemo(() => {
    if (projects.length === 0) {
      return [{ disabled: true, key: 'empty', label: t('management.filters.project.empty') }];
    }
    return projects.map((p) => ({
      icon: <CheckMark visible={groupIds.includes(p.value)} />,
      key: p.value,
      label: p.label,
      onClick: () =>
        setGroupIds(
          groupIds.includes(p.value)
            ? groupIds.filter((x) => x !== p.value)
            : [...groupIds, p.value],
        ),
    }));
  }, [projects, groupIds, t, setGroupIds]);

  const timeItems: DropdownItem[] = useMemo(
    () =>
      TIME_OPTIONS.map((r) => ({
        icon: <CheckMark visible={timeRange === r} />,
        key: r,
        label: t(`management.filters.time.${r}` as any) as string,
        onClick: () => setTimeRange(r),
      })),
    [timeRange, t, setTimeRange],
  );

  const sortItems: DropdownItem[] = useMemo(
    () =>
      SORT_OPTIONS.map((s) => ({
        icon: <CheckMark visible={sortBy === s} />,
        key: s,
        label: t(`management.sort.${s}` as any) as string,
        onClick: () => setSortBy(s),
      })),
    [sortBy, t, setSortBy],
  );

  const groupItems: DropdownItem[] = useMemo(
    () =>
      GROUP_OPTIONS.map((g) => ({
        icon: <CheckMark visible={groupBy === g} />,
        key: g,
        label: t(`management.group.${g}` as any) as string,
        onClick: () => setGroupBy(g),
      })),
    [groupBy, t, setGroupBy],
  );

  const triggerApplied = triggers.length > 0;
  const projectApplied = groupIds.length > 0;
  const timeApplied = timeRange !== 'all';
  const anyFilterApplied = triggerApplied || projectApplied || timeApplied;

  const addFilterItems: DropdownItem[] = useMemo(() => {
    const items: DropdownItem[] = [];
    if (!triggerApplied) {
      items.push({
        children: triggerItems,
        icon: <Icon icon={ListFilter} size={14} />,
        key: 'trigger',
        label: t('management.filters.trigger.label'),
        type: 'submenu',
      });
    }
    if (!projectApplied) {
      items.push({
        children: projectItems,
        icon: <Icon icon={FolderClosed} size={14} />,
        key: 'project',
        label: t('management.filters.project.label'),
        type: 'submenu',
      });
    }
    if (!timeApplied) {
      items.push({
        children: timeItems,
        icon: <Icon icon={CalendarRange} size={14} />,
        key: 'time',
        label: t('management.filters.time.label'),
        type: 'submenu',
      });
    }
    return items;
  }, [triggerApplied, projectApplied, timeApplied, triggerItems, projectItems, timeItems, t]);

  const projectChipValue = useMemo(() => {
    if (groupIds.length === 1) {
      return projects.find((p) => p.value === groupIds[0])?.label ?? groupIds[0];
    }
    return `${groupIds.length} selected`;
  }, [groupIds, projects]);

  const triggerChipValue =
    triggers.length === 1
      ? (t(`management.filters.trigger.${triggers[0]}` as any) as string)
      : `${triggers.length} selected`;

  const handleArchiveStale = useCallback(() => {
    const cutoff = Date.now() - THREE_MONTHS_MS;
    const stale = (topics ?? []).filter((tp) => {
      if (tp.status === 'completed') return false;
      const updated =
        typeof tp.updatedAt === 'number' ? tp.updatedAt : new Date(tp.updatedAt).getTime();
      return updated < cutoff;
    });

    if (stale.length === 0) {
      message.info(t('management.actionsMenu.archiveStale.noneFound'));
      return;
    }

    confirmModal({
      content: t('management.actionsMenu.archiveStale.confirm', { count: stale.length }),
      okText: t('management.actionsMenu.archiveStale.confirmOk'),
      onOk: async () => {
        for (const topic of stale) {
          await updateTopicStatus({ status: 'completed', topicId: topic.id });
        }
        message.success(t('management.actionsMenu.archiveStale.done', { count: stale.length }));
      },
      title: t('management.actionsMenu.archiveStale.title'),
    });
  }, [topics, updateTopicStatus, message, t]);

  const overflowItems: DropdownItem[] = useMemo(() => {
    const items: DropdownItem[] = [
      {
        children: groupItems,
        key: 'group',
        label: `${t('management.group.label')}: ${t(`management.group.${groupBy}` as any)}`,
        type: 'submenu',
      },
    ];
    if (anyFilterApplied) {
      items.push(
        { key: 'd1', type: 'divider' as const },
        {
          icon: <Icon icon={X} size={14} />,
          key: 'clear',
          label: t('management.filters.clearAll', { defaultValue: 'Clear all filters' }),
          onClick: () => {
            setTriggers([]);
            setGroupIds([]);
            setTimeRange('all');
          },
        },
      );
    }
    items.push(
      { key: 'd2', type: 'divider' as const },
      {
        icon: <Icon icon={Archive} size={14} />,
        key: 'archive-stale',
        label: t('management.actionsMenu.archiveStale.label'),
        onClick: handleArchiveStale,
      },
    );
    return items;
  }, [
    groupItems,
    groupBy,
    anyFilterApplied,
    t,
    setTriggers,
    setGroupIds,
    setTimeRange,
    handleArchiveStale,
  ]);

  return (
    <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
      <Tabs
        activeKey={status}
        size={'small'}
        style={{ width: 'auto' }}
        items={STATUS_OPTIONS.map((opt) => {
          const count = statusCounts[opt.key] ?? 0;
          return {
            key: opt.key,
            label: (
              <Flexbox horizontal align={'center'} gap={6}>
                <span>{t(opt.labelKey as any) as string}</span>
                <Text
                  style={{
                    color: status === opt.key ? 'inherit' : cssVar.colorTextTertiary,
                    fontSize: 12,
                    fontVariantNumeric: 'tabular-nums',
                    opacity: status === opt.key ? 0.7 : 1,
                  }}
                >
                  {count}
                </Text>
              </Flexbox>
            ),
          };
        })}
        onChange={(key) => setStatus(key as StatusFilter)}
      />

      <span className={styles.divider} />

      {triggerApplied && (
        <FilterChip
          icon={ListFilter}
          items={triggerItems}
          label={t('management.filters.trigger.label')}
          value={triggerChipValue}
          onClear={() => setTriggers([])}
        />
      )}
      {projectApplied && (
        <FilterChip
          icon={FolderClosed}
          items={projectItems}
          label={t('management.filters.project.label')}
          value={projectChipValue}
          onClear={() => setGroupIds([])}
        />
      )}
      {timeApplied && (
        <FilterChip
          icon={CalendarRange}
          items={timeItems}
          label={t('management.filters.time.label')}
          value={t(`management.filters.time.${timeRange}` as any) as string}
          onClear={() => setTimeRange('all')}
        />
      )}

      {addFilterItems.length > 0 && (
        <DropdownMenu items={addFilterItems}>
          <span className={styles.addPill}>
            <Icon icon={Plus} size={12} />
            {t('management.filters.add', {
              defaultValue: anyFilterApplied ? 'Add filter' : 'Filter',
            })}
          </span>
        </DropdownMenu>
      )}

      <Flexbox flex={1} />

      <Tabs
        activeKey={viewMode}
        size={'small'}
        style={{ width: 'auto' }}
        items={[
          {
            key: 'card',
            label: (
              <Tooltip title={t('management.view.card')}>
                <Icon icon={LayoutGrid} />
              </Tooltip>
            ),
          },
          {
            key: 'list',
            label: (
              <Tooltip title={t('management.view.list')}>
                <Icon icon={ListIcon} />
              </Tooltip>
            ),
          },
        ]}
        onChange={(key) => setViewMode(key as 'card' | 'list')}
      />

      <span className={styles.divider} />

      <DropdownMenu items={sortItems}>
        <span className={styles.sortPill}>
          <Text style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
            {t('management.sort.label')}:
          </Text>
          <span style={{ fontWeight: 500 }}>{t(`management.sort.${sortBy}` as any)}</span>
          <Icon icon={ChevronDown} size={10} />
        </span>
      </DropdownMenu>

      <DropdownMenu items={overflowItems} placement={'bottomRight'}>
        <ActionIcon
          icon={MoreHorizontal}
          size={{ blockSize: CONTROL_HEIGHT, size: 18 }}
          title={t('management.actionsMenu.title')}
        />
      </DropdownMenu>
    </Flexbox>
  );
});

Toolbar.displayName = 'AgentTopicManagerToolbar';

export default Toolbar;
