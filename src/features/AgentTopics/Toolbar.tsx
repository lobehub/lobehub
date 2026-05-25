'use client';

import { Button, type DropdownItem, DropdownMenu, Flexbox, Icon, Input, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDown, Search, Star } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTopicsViewStore } from './store';
import type { SortBy, StatusFilter, TimeRangeFilter, TriggerFilter } from './types';

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    cursor: pointer;
    user-select: none;
    transition: all 0.15s;

    &:hover {
      border-color: ${cssVar.colorBorderSecondary};
    }
  `,
  chipActive: css`
    cursor: pointer;
    user-select: none;
    border-color: transparent;
    background: ${cssVar.colorFillSecondary};
  `,
  divider: css`
    width: 1px;
    height: 16px;
    margin-inline: 4px;
    background: ${cssVar.colorBorderSecondary};
  `,
  search: css`
    max-width: 480px;
  `,
}));

const STATUS_OPTIONS: { key: StatusFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'management.filters.status.all' },
  { key: 'favorite', labelKey: 'management.filters.status.favorite' },
  { key: 'active', labelKey: 'management.filters.status.active' },
  { key: 'completed', labelKey: 'management.filters.status.completed' },
  { key: 'archived', labelKey: 'management.filters.status.archived' },
];

const TRIGGER_OPTIONS: TriggerFilter[] = ['chat', 'api', 'cron', 'eval'];

const TIME_OPTIONS: TimeRangeFilter[] = ['all', 'today', 'week', 'month'];

const SORT_OPTIONS: SortBy[] = ['updatedAt', 'createdAt', 'title'];

interface ToolbarProps {
  projects: { label: string; value: string }[];
}

const CheckMark = ({ visible }: { visible: boolean }) => (
  <span style={{ display: 'inline-block', width: 12 }}>{visible ? '✓' : ''}</span>
);

const Toolbar = memo<ToolbarProps>(({ projects }) => {
  const { t } = useTranslation('topic');

  const search = useTopicsViewStore((s) => s.search);
  const setSearch = useTopicsViewStore((s) => s.setSearch);
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
        icon: <CheckMark visible={triggers.includes(tr)} />,
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

  return (
    <Flexbox gap={12}>
      <Input
        className={styles.search}
        placeholder={t('management.searchPlaceholder')}
        prefix={<Icon icon={Search} size={'small'} />}
        size={'large'}
        value={search}
        variant={'filled'}
        onChange={(e) => setSearch(e.target.value)}
      />

      <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
        {STATUS_OPTIONS.map((opt) => {
          const active = status === opt.key;
          const labelText = t(opt.labelKey as any) as string;
          return (
            <Tag
              bordered
              className={active ? styles.chipActive : styles.chip}
              key={opt.key}
              onClick={() => setStatus(opt.key)}
            >
              {opt.key === 'favorite' ? (
                <Flexbox horizontal align={'center'} gap={4}>
                  <Icon icon={Star} size={11} />
                  {labelText}
                </Flexbox>
              ) : (
                labelText
              )}
            </Tag>
          );
        })}

        <span className={styles.divider} />

        <DropdownMenu items={projectMenu}>
          <Button size={'small'} variant={'filled'}>
            <Flexbox horizontal align={'center'} gap={4}>
              {projectLabel}
              <Icon icon={ChevronDown} size={11} />
            </Flexbox>
          </Button>
        </DropdownMenu>

        <DropdownMenu items={triggerMenu}>
          <Button size={'small'} variant={'filled'}>
            <Flexbox horizontal align={'center'} gap={4}>
              {triggerLabel}
              <Icon icon={ChevronDown} size={11} />
            </Flexbox>
          </Button>
        </DropdownMenu>

        <DropdownMenu items={timeMenu}>
          <Button size={'small'} variant={'filled'}>
            <Flexbox horizontal align={'center'} gap={4}>
              {timeLabel}
              <Icon icon={ChevronDown} size={11} />
            </Flexbox>
          </Button>
        </DropdownMenu>

        <Flexbox flex={1} />

        <DropdownMenu items={sortMenu}>
          <Button size={'small'} variant={'filled'}>
            <Flexbox horizontal align={'center'} gap={4}>
              {sortLabel}
              <Icon icon={ChevronDown} size={11} />
            </Flexbox>
          </Button>
        </DropdownMenu>
      </Flexbox>
    </Flexbox>
  );
});

Toolbar.displayName = 'AgentTopicsToolbar';

export default Toolbar;
