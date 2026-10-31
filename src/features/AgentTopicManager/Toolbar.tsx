'use client';

import {
  ActionIcon,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Tabs,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  Archive,
  CalendarRange,
  ChevronDown,
  FolderClosed,
  Hash,
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

import { getPlatformIcon } from '@/features/AgentChannel/const';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useTopicsViewStore } from './store';
import type {
  BotChannelOption,
  GroupBy,
  SortBy,
  StatusFilter,
  TimeRangeFilter,
  TriggerFilter,
} from './types';

const CONTROL_HEIGHT = 32;
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

// Control height is 32px, so a pill's radius is 16px.
const styles = stylex.create({
  addPill: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    height: '32px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: {
      'default': cssVar.colorBorder,
      ':hover': cssVar.colorPrimary,
    },
    borderRadius: '16px',
    fontSize: '13px',
    color: {
      'default': cssVar.colorTextSecondary,
      ':hover': cssVar.colorText,
    },
    transition: 'all 0.15s',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'stretch',
    height: '32px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      'default': cssVar.colorBorderSecondary,
      ':hover': cssVar.colorBorder,
    },
    borderRadius: '16px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
    transition: 'border-color 0.15s',
  },
  // Reset of the native button (the stylesheet had `all: unset`).
  chipClose: {
    cursor: 'pointer',
    boxSizing: 'content-box',
    display: 'inline-flex',
    alignItems: 'center',
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: '8px',
    paddingInlineEnd: '12px',
    borderWidth: 0,
    borderStyle: 'none',
    borderStartEndRadius: '16px',
    borderEndEndRadius: '16px',
    outlineStyle: 'none',
    appearance: 'none',
    font: 'inherit',
    color: {
      'default': cssVar.colorTextTertiary,
      ':hover': cssVar.colorText,
    },
    textAlign: 'inherit',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillSecondary,
    },
    backgroundImage: 'none',
  },
  chipMain: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    paddingBlock: 0,
    paddingInlineStart: '12px',
    paddingInlineEnd: '6px',
    fontSize: '13px',
    color: cssVar.colorText,
  },
  chipValue: {
    fontWeight: 500,
    color: cssVar.colorText,
  },
  divider: {
    width: '1px',
    height: '16px',
    marginInline: '4px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  sortPill: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    height: '32px',
    paddingInline: '12px',
    borderRadius: '16px',
    fontSize: '13px',
    color: cssVar.colorText,
    backgroundColor: {
      'default': cssVar.colorFillTertiary,
      ':hover': cssVar.colorFillSecondary,
    },
    backgroundImage: 'none',
  },
});

const STATUS_OPTIONS: { key: StatusFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'management.filters.status.all' },
  { key: 'active', labelKey: 'management.filters.status.active' },
  { key: 'running', labelKey: 'management.filters.status.running' },
  { key: 'completed', labelKey: 'management.filters.status.completed' },
];

const TRIGGER_OPTIONS: TriggerFilter[] = ['chat', 'bot', 'api', 'task', 'eval'];

const TRIGGER_ICON: Record<TriggerFilter, LucideIcon> = {
  api: Webhook,
  bot: Hash,
  chat: MessageCircle,
  eval: TestTubeIcon,
  task: ListTodoIcon,
};

const TIME_OPTIONS: TimeRangeFilter[] = ['all', 'today', 'week', 'month'];

const SORT_OPTIONS: SortBy[] = ['updatedAt', 'createdAt', 'title'];

const GROUP_OPTIONS: GroupBy[] = ['byTime', 'byProject', 'none'];

interface ToolbarProps {
  botChannelOptions: BotChannelOption[];
  projects: { label: string; value: string }[];
  statusCounts: Record<StatusFilter, number>;
}

const CheckMark = ({ visible }: { visible: boolean }) => (
  <span style={{ display: 'inline-block', width: 12 }}>{visible ? '✓' : ''}</span>
);

interface FilterChipProps {
  icon?: LucideIcon;
  iconNode?: ReactNode;
  items: DropdownItem[];
  label: string;
  onClear: () => void;
  value: ReactNode;
}

const FilterChip = memo<FilterChipProps>(({ icon, iconNode, label, value, items, onClear }) => {
  return (
    <span {...stylex.props(styles.chip)}>
      <DropdownMenu items={items}>
        <span {...stylex.props(styles.chipMain)}>
          {iconNode ?? (icon && <Icon icon={icon} size={12} />)}
          <Text style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>{label}:</Text>
          <span {...stylex.props(styles.chipValue)}>{value}</span>
          <Icon icon={ChevronDown} size={10} />
        </span>
      </DropdownMenu>
      <button
        aria-label={`Clear ${label}`}
        {...stylex.props(styles.chipClose)}
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

const Toolbar = memo<ToolbarProps>(({ projects, statusCounts, botChannelOptions }) => {
  const { t } = useTranslation('topic');

  const topics = useChatStore(topicSelectors.agentTopicsViewTopics);
  const updateTopicStatus = useChatStore((s) => s.updateTopicStatus);

  const status = useTopicsViewStore((s) => s.status);
  const setStatus = useTopicsViewStore((s) => s.setStatus);
  const groupIds = useTopicsViewStore((s) => s.groupIds);
  const setGroupIds = useTopicsViewStore((s) => s.setGroupIds);
  const triggers = useTopicsViewStore((s) => s.triggers);
  const setTriggers = useTopicsViewStore((s) => s.setTriggers);
  const toggleTrigger = useTopicsViewStore((s) => s.toggleTrigger);
  const botChannels = useTopicsViewStore((s) => s.botChannels);
  const setBotChannels = useTopicsViewStore((s) => s.setBotChannels);
  const toggleBotChannel = useTopicsViewStore((s) => s.toggleBotChannel);
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
        onClick: () => toggleTrigger(tr),
      })),
    [triggers, t, toggleTrigger],
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

  // Flattened "send source" filter: one entry per bot platform (per review,
  // only distinguish tg/discord level — no per-channel submenu).
  const botChannelItems: DropdownItem[] = useMemo(() => {
    if (botChannelOptions.length === 0) {
      return [{ disabled: true, key: 'empty', label: t('management.filters.botChannel.empty') }];
    }
    return botChannelOptions.map((option) => {
      const PlatformIcon = getPlatformIcon(option.key);
      return {
        extra: <CheckMark visible={botChannels.includes(option.key)} />,
        icon: PlatformIcon ? <PlatformIcon size={14} /> : <Icon icon={Hash} size={14} />,
        key: option.key,
        label: option.label,
        onClick: () => toggleBotChannel(option.key),
      };
    });
  }, [botChannelOptions, botChannels, t, toggleBotChannel]);

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
  const botChannelApplied = botChannels.length > 0;
  const timeApplied = timeRange !== 'all';
  const anyFilterApplied = triggerApplied || projectApplied || botChannelApplied || timeApplied;

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
    if (!botChannelApplied) {
      items.push({
        children: botChannelItems,
        icon: <Icon icon={Hash} size={14} />,
        key: 'botChannel',
        label: t('management.filters.botChannel.label'),
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
  }, [
    triggerApplied,
    projectApplied,
    botChannelApplied,
    timeApplied,
    triggerItems,
    projectItems,
    botChannelItems,
    timeItems,
    t,
  ]);

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

  // Single selection shows the channel (platform) name; multi shows a count.
  const botChannelChipValue = useMemo(() => {
    if (botChannels.length !== 1) return `${botChannels.length} selected`;
    const selected = botChannels[0];
    return botChannelOptions.find((o) => o.key === selected)?.label ?? selected;
  }, [botChannels, botChannelOptions]);

  const botChannelChipIcon = useMemo(() => {
    if (botChannels.length !== 1) return <Icon icon={Hash} size={12} />;
    const PlatformIcon = getPlatformIcon(botChannels[0]);
    return PlatformIcon ? <PlatformIcon size={12} /> : <Icon icon={Hash} size={12} />;
  }, [botChannels]);

  const handleArchiveStale = useCallback(() => {
    const cutoff = Date.now() - THREE_MONTHS_MS;
    const stale = (topics ?? []).filter((tp) => {
      if (tp.status === 'completed') return false;
      const updated =
        typeof tp.updatedAt === 'number' ? tp.updatedAt : new Date(tp.updatedAt).getTime();
      return updated < cutoff;
    });

    if (stale.length === 0) {
      toast.info(t('management.actionsMenu.archiveStale.noneFound'));
      return;
    }

    confirmModal({
      content: t('management.actionsMenu.archiveStale.confirm', { count: stale.length }),
      okText: t('management.actionsMenu.archiveStale.confirmOk'),
      onOk: async () => {
        for (const topic of stale) {
          await updateTopicStatus({ status: 'completed', topicId: topic.id });
        }
        toast.success(t('management.actionsMenu.archiveStale.done', { count: stale.length }));
      },
      title: t('management.actionsMenu.archiveStale.title'),
    });
  }, [topics, updateTopicStatus, t]);

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
            setBotChannels([]);
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
    setBotChannels,
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

      <span {...stylex.props(styles.divider)} />

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
      {botChannelApplied && (
        <FilterChip
          iconNode={botChannelChipIcon}
          items={botChannelItems}
          label={t('management.filters.botChannel.label')}
          value={botChannelChipValue}
          onClear={() => setBotChannels([])}
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
          <span {...stylex.props(styles.addPill)}>
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

      <span {...stylex.props(styles.divider)} />

      <DropdownMenu items={sortItems}>
        <span {...stylex.props(styles.sortPill)}>
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
