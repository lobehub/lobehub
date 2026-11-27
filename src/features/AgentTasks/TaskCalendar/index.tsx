import type { TaskListFilter } from '@lobechat/types';
import { ActionIcon, Button, Center, Empty, Flexbox, Popover, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs, { type Dayjs } from 'dayjs';
import { CalendarClockIcon, ChevronLeft, ChevronRight, Info, Plus } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { normalizeDayjsLocale } from '@/utils/dayjsLocale';

import type { TaskItemRouteScope } from '../features/AgentTaskItem';
import type { TaskCollection } from '../shared/taskCollection';
import { CalendarEntryCard } from './CalendarEntryCard';
import {
  buildMonthGrid,
  collectCompletedEntries,
  collectScheduledEntries,
  dayKey,
  formatViewerTimezone,
  groupEntriesByDay,
  resolveWeekStart,
  type TaskCalendarEntry,
} from './calendarModel';
import { useTaskCalendarTasks } from './useTaskCalendarTasks';

/** How often the calendar's clock advances: today's highlight and which runs are still ahead. */
const CLOCK_TICK_MS = 60_000;

/** Entries the "+N" popover lists before naming how many more there are. */
const POPOVER_MAX_ENTRIES = 100;

/** Entries a day cell shows before folding the rest behind "+N". */
const VISIBLE_ENTRIES_PER_DAY = 3;

const styles = stylex.create({
  cell: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    borderInlineStartColor: cssVar.colorBorderSecondary,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minHeight: 120,
    minWidth: 0,
    padding: 6,
  },
  dayNumber: {
    alignItems: 'center',
    borderRadius: 11,
    color: cssVar.colorTextSecondary,
    display: 'inline-flex',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    height: 22,
    justifyContent: 'center',
    minWidth: 22,
    paddingInline: 4,
  },
  grid: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    borderInlineEndColor: cssVar.colorBorderSecondary,
    borderInlineEndStyle: 'solid',
    borderInlineEndWidth: 1,
    borderRadius: 8,
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    overflow: 'hidden',
  },
  more: {
    backgroundColor: 'transparent',
    borderStyle: 'none',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 12,
    paddingBlock: 0,
    paddingInline: 6,
    textAlign: 'start',
  },
  outside: {
    backgroundColor: cssVar.colorFillQuaternary,
  },
  today: {
    backgroundColor: cssVar.colorPrimaryBg,
  },
  todayNumber: {
    backgroundColor: cssVar.colorPrimary,
    color: cssVar.colorTextLightSolid,
    fontWeight: 600,
  },
  weekday: {
    borderInlineStartColor: cssVar.colorBorderSecondary,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: 1,
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    paddingBlock: 6,
    paddingInline: 8,
  },
});

interface DayCellProps {
  day: Dayjs;
  entries: TaskCalendarEntry[];
  inMonth: boolean;
  isToday: boolean;
  routeScope: TaskItemRouteScope;
}

const DayCell = memo<DayCellProps>(({ day, entries, inMonth, isToday, routeScope }) => {
  const { t, i18n } = useTranslation('chat');
  const locale = normalizeDayjsLocale(i18n.language);
  // The folded cards are only built while the popover is open.
  const [moreOpen, setMoreOpen] = useState(false);
  const visible = entries.slice(0, VISIBLE_ENTRIES_PER_DAY);
  const hidden = entries.length - visible.length;
  const renderCard = (entry: TaskCalendarEntry) => (
    <CalendarEntryCard
      entry={entry}
      key={`${entry.kind}:${entry.task.id}:${entry.at.getTime()}`}
      routeScope={routeScope}
    />
  );

  return (
    <div
      aria-current={isToday ? 'date' : undefined}
      {...stylex.props(styles.cell, !inMonth && styles.outside, isToday && styles.today)}
      data-day={dayKey(day)}
    >
      <span {...stylex.props(styles.dayNumber, isToday && styles.todayNumber)}>{day.date()}</span>
      {visible.map(renderCard)}
      {hidden > 0 && (
        <Popover
          arrow={false}
          open={moreOpen}
          placement={'bottom'}
          trigger={['click']}
          content={
            moreOpen ? (
              <Flexbox gap={4} style={{ maxHeight: 360, overflowY: 'auto' }} width={240}>
                <Text fontSize={12} type={'secondary'} weight={500}>
                  {day.locale(locale).format(t('taskList.calendar.dayFormat'))}
                </Text>
                {entries.slice(0, POPOVER_MAX_ENTRIES).map(renderCard)}
                {entries.length > POPOVER_MAX_ENTRIES && (
                  <Text fontSize={12} type={'secondary'}>
                    {t('taskList.calendar.more', {
                      count: entries.length - POPOVER_MAX_ENTRIES,
                    })}
                  </Text>
                )}
              </Flexbox>
            ) : null
          }
          onOpenChange={setMoreOpen}
        >
          <button type={'button'} {...stylex.props(styles.more)}>
            {t('taskList.calendar.more', { count: hidden })}
          </button>
        </Popover>
      )}
    </div>
  );
});

DayCell.displayName = 'TaskCalendarDayCell';

const CalendarSkeleton = () => (
  <Flexbox gap={8}>
    <Skeleton height={32} width={'100%'} />
    <Skeleton height={480} width={'100%'} />
  </Flexbox>
);

export interface TaskCalendarProps {
  agentId?: string;
  /** Offers creating the first automated task from the empty scheduled calendar. */
  canCreate?: boolean;
  collection: TaskCollection;
  filter?: TaskListFilter;
  includeArchived?: boolean;
  myTaskScope?: 'assigned' | 'created';
  onCreateScheduled?: () => void;
  projectId?: string;
  routeScope: TaskItemRouteScope;
}

/**
 * The Tasks page's month calendar. On the scheduled collection it shows each
 * recurring task's past runs (with their result and note) and its planned
 * ones; elsewhere it shows completed tasks on the day they were completed.
 * Days follow the viewer's local timezone, which the header names.
 */
const TaskCalendar = memo<TaskCalendarProps>(
  ({
    agentId,
    canCreate,
    collection,
    filter,
    includeArchived,
    myTaskScope,
    onCreateScheduled,
    projectId,
    routeScope,
  }) => {
    const { t, i18n } = useTranslation('chat');
    const locale = normalizeDayjsLocale(i18n.language);
    // "Now" for today's highlight, the timezone label and where planned runs
    // begin. It advances each minute, so a calendar left open stays current.
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
      const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
      return () => clearInterval(timer);
    }, []);
    const [month, setMonth] = useState(() => dayjs(now).startOf('month'));
    const weekStartsOn = resolveWeekStart(i18n.language);
    const grid = useMemo(() => buildMonthGrid(month, weekStartsOn), [month, weekStartsOn]);
    const range = useMemo(() => ({ from: grid.from, to: grid.to }), [grid]);
    const isScheduled = collection === 'scheduled';

    const { data, error, isLoading, mutate } = useTaskCalendarTasks({
      agentId,
      collection,
      filter,
      includeArchived,
      myTaskScope,
      projectId,
      range,
    });

    const { entriesByDay, planTruncated } = useMemo(() => {
      if (!data)
        return { entriesByDay: new Map<string, TaskCalendarEntry[]>(), planTruncated: false };
      const { entries, truncated } = isScheduled
        ? collectScheduledEntries(data.tasks, range, now)
        : { entries: collectCompletedEntries(data.tasks, range), truncated: false };
      return { entriesByDay: groupEntriesByDay(entries), planTruncated: truncated };
    }, [data, isScheduled, now, range]);

    const todayKey = dayKey(now);
    const weekdays = grid.weeks[0].map((day) => day.locale(locale).format('ddd'));
    const isEmptySchedule = isScheduled && !filter && data?.tasks.length === 0;

    return (
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={4}>
            <ActionIcon
              icon={ChevronLeft}
              size={'small'}
              title={t('taskList.calendar.prevMonth')}
              onClick={() => setMonth((current) => current.subtract(1, 'month'))}
            />
            <ActionIcon
              icon={ChevronRight}
              size={'small'}
              title={t('taskList.calendar.nextMonth')}
              onClick={() => setMonth((current) => current.add(1, 'month'))}
            />
            <Text as={'h2'} style={{ fontSize: 16, fontWeight: 600, margin: 0, marginInline: 8 }}>
              {month.locale(locale).format(t('taskList.calendar.monthFormat'))}
            </Text>
            <Button size={'small'} onClick={() => setMonth(dayjs(now).startOf('month'))}>
              {t('taskList.calendar.today')}
            </Button>
          </Flexbox>
          <Text fontSize={12} type={'secondary'}>
            {t('taskList.calendar.timezone', { timezone: formatViewerTimezone(range) })}
          </Text>
        </Flexbox>
        {!isScheduled && (
          <Flexbox horizontal align={'center'} gap={6}>
            <Info color={cssVar.colorTextTertiary} size={12} />
            <Text fontSize={12} type={'secondary'}>
              {t('taskList.calendar.completedHint')}
            </Text>
          </Flexbox>
        )}
        {(data?.truncated || planTruncated) && (
          <Flexbox horizontal align={'center'} gap={6}>
            <Info color={cssVar.colorWarning} size={12} />
            <Text fontSize={12} type={'secondary'}>
              {t('taskList.calendar.truncated')}
            </Text>
          </Flexbox>
        )}
        <AsyncBoundary
          data={data}
          error={error}
          errorVariant={'block'}
          isEmpty={isEmptySchedule}
          isLoading={isLoading}
          loading={<CalendarSkeleton />}
          empty={
            <Center height={'60vh'} width={'100%'}>
              <Empty
                description={t('taskList.calendar.empty.description')}
                icon={CalendarClockIcon}
                title={t('taskList.calendar.empty.title')}
                action={
                  canCreate && onCreateScheduled ? (
                    <Button icon={Plus} type={'primary'} onClick={onCreateScheduled}>
                      {t('taskList.calendar.empty.create')}
                    </Button>
                  ) : undefined
                }
              />
            </Center>
          }
          onRetry={() => mutate()}
        >
          <div role={'grid'} {...stylex.props(styles.grid)}>
            {weekdays.map((weekday) => (
              <div key={weekday} role={'columnheader'} {...stylex.props(styles.weekday)}>
                {weekday}
              </div>
            ))}
            {grid.weeks.flat().map((day) => {
              const key = dayKey(day);
              return (
                <DayCell
                  day={day}
                  entries={entriesByDay.get(key) ?? []}
                  inMonth={day.month() === month.month()}
                  isToday={key === todayKey}
                  key={key}
                  routeScope={routeScope}
                />
              );
            })}
          </div>
        </AsyncBoundary>
      </Flexbox>
    );
  },
);

TaskCalendar.displayName = 'TaskCalendar';

export default TaskCalendar;
