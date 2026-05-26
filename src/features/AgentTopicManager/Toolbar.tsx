'use client';

import {
  Button,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Segmented,
  Text,
} from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ChevronDown,
  ListTodoIcon,
  type LucideIcon,
  MessageCircle,
  TestTubeIcon,
  Webhook,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTopicsViewStore } from './store';
import ToolbarActions from './ToolbarActions';
import type { GroupBy, SortBy, StatusFilter, TimeRangeFilter, TriggerFilter } from './types';

const styles = createStaticStyles(({ css }) => ({
  divider: css`
    width: 1px;
    height: 16px;
    margin-inline: 4px;
    background: ${cssVar.colorBorderSecondary};
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

const Toolbar = memo<ToolbarProps>(({ projects, statusCounts }) => {
  const { t } = useTranslation('topic');

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

  const projectMenu: DropdownItem[] = useMemo(() => {
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

  const triggerMenu: DropdownItem[] = useMemo(
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

  const timeMenu: DropdownItem[] = useMemo(
    () =>
      TIME_OPTIONS.map((r) => ({
        icon: <CheckMark visible={timeRange === r} />,
        key: r,
        label: t(`management.filters.time.${r}` as any) as string,
        onClick: () => setTimeRange(r),
      })),
    [timeRange, t, setTimeRange],
  );

  const sortMenu: DropdownItem[] = useMemo(
    () =>
      SORT_OPTIONS.map((s) => ({
        icon: <CheckMark visible={sortBy === s} />,
        key: s,
        label: t(`management.sort.${s}` as any) as string,
        onClick: () => setSortBy(s),
      })),
    [sortBy, t, setSortBy],
  );

  const groupMenu: DropdownItem[] = useMemo(
    () =>
      GROUP_OPTIONS.map((g) => ({
        icon: <CheckMark visible={groupBy === g} />,
        key: g,
        label: t(`management.group.${g}` as any) as string,
        onClick: () => setGroupBy(g),
      })),
    [groupBy, t, setGroupBy],
  );

  const triggerLabel =
    triggers.length === 0
      ? (t('management.filters.trigger.label') as string)
      : `${t('management.filters.trigger.label')} (${triggers.length})`;

  const projectLabel =
    groupIds.length === 0
      ? (t('management.filters.project.label') as string)
      : `${t('management.filters.project.label')} (${groupIds.length})`;

  const timeLabel =
    timeRange === 'all'
      ? (t('management.filters.time.label') as string)
      : (t(`management.filters.time.${timeRange}` as any) as string);

  const sortLabel = `${t('management.sort.label')}: ${t(`management.sort.${sortBy}` as any)}`;
  const groupLabel = `${t('management.group.label')}: ${t(`management.group.${groupBy}` as any)}`;

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
        <Segmented
          value={status}
          options={STATUS_OPTIONS.map((opt) => {
            const count = statusCounts[opt.key] ?? 0;
            return {
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
              value: opt.key,
            };
          })}
          onChange={(v) => setStatus(v as StatusFilter)}
        />

        <span className={styles.divider} />

        <DropdownMenu items={projectMenu}>
          <Button variant={'filled'}>
            <Flexbox horizontal align={'center'} gap={4}>
              {projectLabel}
              <Icon icon={ChevronDown} size={11} />
            </Flexbox>
          </Button>
        </DropdownMenu>

        <DropdownMenu items={triggerMenu}>
          <Button variant={'filled'}>
            <Flexbox horizontal align={'center'} gap={4}>
              {triggerLabel}
              <Icon icon={ChevronDown} size={11} />
            </Flexbox>
          </Button>
        </DropdownMenu>

        <DropdownMenu items={timeMenu}>
          <Button variant={'filled'}>
            <Flexbox horizontal align={'center'} gap={4}>
              {timeLabel}
              <Icon icon={ChevronDown} size={11} />
            </Flexbox>
          </Button>
        </DropdownMenu>

        <Flexbox flex={1} />

        <DropdownMenu items={groupMenu}>
          <Button variant={'filled'}>
            <Flexbox horizontal align={'center'} gap={4}>
              {groupLabel}
              <Icon icon={ChevronDown} size={11} />
            </Flexbox>
          </Button>
        </DropdownMenu>

        <DropdownMenu items={sortMenu}>
          <Button variant={'filled'}>
            <Flexbox horizontal align={'center'} gap={4}>
              {sortLabel}
              <Icon icon={ChevronDown} size={11} />
            </Flexbox>
          </Button>
        </DropdownMenu>

        <ToolbarActions />
      </Flexbox>
    </Flexbox>
  );
});

Toolbar.displayName = 'AgentTopicManagerToolbar';

export default Toolbar;
