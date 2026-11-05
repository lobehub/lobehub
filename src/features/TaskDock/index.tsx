import { ActionIcon, Flexbox, Icon, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CheckIcon,
  ChevronDownIcon,
  CircleSlashIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Item from './Item';
import {
  groupDockTasks,
  hasCancellableTask,
  isActiveTask,
  resolveDockOverview,
  shouldAutoDismiss,
} from './presentation';
import type { DockTask } from './type';
import { useDockTasks } from './useDockTasks';

/** How long a resultless success stays readable before it clears itself. */
const AUTO_DISMISS_DELAY = 3000;
/** Lets a burst of dismissals finish before the dock changes shape. */
const SHAPE_SETTLE_DELAY = 400;

const styles = stylex.create({
  container: {
    position: 'fixed',
    zIndex: 100,
    insetBlockEnd: '24px',
    insetInlineEnd: '24px',
    overflow: 'hidden',
    width: '340px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
  groupHead: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorFillQuaternary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextDescription,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  head: { cursor: 'pointer', paddingBlock: '9px', paddingInline: '12px' },
  headDivider: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  list: { overflowY: 'auto', maxHeight: '340px' },
  row: {
    borderBlockStartWidth: { 'default': null, ':not(:first-child)': '1px' },
    borderBlockStartStyle: { 'default': null, ':not(:first-child)': 'solid' },
    borderBlockStartColor: { 'default': null, ':not(:first-child)': cssVar.colorFillQuaternary },
  },
});

const useSettledShape = (count: number): 'solo' | 'panel' => {
  const [shape, setShape] = useState<'solo' | 'panel'>(count > 1 ? 'panel' : 'solo');

  useEffect(() => {
    const next = count > 1 ? 'panel' : 'solo';
    if (next === shape) return;
    // Growing is unambiguous; shrinking waits, so a burst of dismissals does
    // not morph the dock once per task on its way down to one.
    if (next === 'panel') {
      setShape('panel');
      return;
    }

    const timer = setTimeout(() => setShape('solo'), SHAPE_SETTLE_DELAY);

    return () => clearTimeout(timer);
  }, [count, shape]);

  return shape;
};

const useAutoDismiss = (tasks: DockTask[]) => {
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const dismissable = tasks.filter((task) => shouldAutoDismiss(task) && !!task.dismiss);
  const ids = dismissable.map((task) => task.id).join('|');

  useEffect(() => {
    if (!ids) return;

    const timers = ids.split('|').map((id) =>
      setTimeout(() => {
        const task = tasksRef.current.find((candidate) => candidate.id === id);
        if (task && shouldAutoDismiss(task)) task.dismiss?.();
      }, AUTO_DISMISS_DELAY),
    );

    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [ids]);
};

/**
 * App-level dock for background work. Producers contribute tasks through
 * `useDockTasks`; the dock owns the shape, the aggregate header and dismissal.
 */
const TaskDock = memo(() => {
  const { t } = useTranslation('common');
  const [expand, setExpand] = useState(true);

  const tasks = useDockTasks();
  const shape = useSettledShape(tasks.length);
  useAutoDismiss(tasks);

  const { activeCount, status } = useMemo(() => resolveDockOverview(tasks), [tasks]);
  const groups = useMemo(() => groupDockTasks(tasks), [tasks]);
  const isRunning = status === 'running';
  const canCancel = useMemo(() => hasCancellableTask(tasks), [tasks]);

  const dismissAll = useCallback(() => {
    tasks.forEach((task) => task.dismiss?.());
  }, [tasks]);

  const cancelAll = useCallback(() => {
    const batched = new Set<string>();

    for (const task of tasks) {
      if (!task.groupCancel) {
        task.cancel?.();
        continue;
      }
      if (batched.has(task.groupLabel)) continue;
      batched.add(task.groupLabel);
      task.groupCancel();
    }
  }, [tasks]);

  const icon = useMemo(() => {
    switch (status) {
      case 'success': {
        return <Icon color={cssVar.colorSuccess} icon={CheckIcon} size={16} />;
      }
      case 'error': {
        return <Icon color={cssVar.colorError} icon={TriangleAlertIcon} size={16} />;
      }
      case 'cancelled': {
        return <Icon color={cssVar.colorTextDescription} icon={CircleSlashIcon} size={16} />;
      }
      default: {
        return <Spin size="small" />;
      }
    }
  }, [status]);

  if (tasks.length === 0) return null;

  // One task speaks for itself: no header, no group gutter, just the row and
  // whatever it left behind.
  if (shape === 'solo') {
    return (
      <Flexbox className={stylex.props(styles.container).className}>
        <Item {...tasks[0]} solo />
      </Flexbox>
    );
  }

  return (
    <Flexbox className={stylex.props(styles.container).className}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.head, expand && styles.headDivider).className}
        gap={10}
        onClick={() => setExpand(!expand)}
      >
        {icon}
        <Flexbox horizontal align={'baseline'} flex={1} gap={7} style={{ minWidth: 0 }}>
          <Text style={{ fontSize: 14 }}>{t(`taskDock.status.${status}`)}</Text>
          <Text ellipsis style={{ fontSize: 12 }} type={'secondary'}>
            {activeCount > 0
              ? t('taskDock.activeOf', { active: activeCount, total: tasks.length })
              : t('taskDock.totalCount', { count: tasks.length })}
          </Text>
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          gap={4}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {canCancel && (
            <Text
              style={{ cursor: 'pointer', flexShrink: 0, fontSize: 12 }}
              type={'secondary'}
              onClick={cancelAll}
            >
              {t('taskDock.cancelAll')}
            </Text>
          )}
          {isRunning ? (
            <ActionIcon
              icon={ChevronDownIcon}
              size={'small'}
              style={{ transform: expand ? undefined : 'rotate(180deg)' }}
              title={t(expand ? 'taskDock.collapse' : 'taskDock.expand')}
              onClick={() => setExpand(!expand)}
            />
          ) : (
            <ActionIcon icon={XIcon} size={'small'} onClick={dismissAll} />
          )}
        </Flexbox>
      </Flexbox>

      <AnimatePresence initial={false}>
        {expand && (
          <m.div
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
          >
            <Flexbox className={stylex.props(styles.list).className}>
              {groups.map((group) => (
                <Flexbox key={group.label}>
                  <Flexbox
                    horizontal
                    align={'center'}
                    className={stylex.props(styles.groupHead).className}
                    justify={'space-between'}
                    paddingBlock={5}
                    // The count aligns with the rows' action glyphs, which sit
                    // 5px inside their own hit area — not with the row padding.
                    style={{ paddingInlineEnd: 19, paddingInlineStart: 12 }}
                  >
                    <span>{group.label}</span>
                    <span>
                      {group.tasks.some(isActiveTask)
                        ? `${group.tasks.filter(isActiveTask).length} / ${group.tasks.length}`
                        : group.tasks.length}
                    </span>
                  </Flexbox>
                  {group.tasks.map((task) => (
                    <Flexbox className={stylex.props(styles.row).className} key={task.id}>
                      <Item {...task} />
                    </Flexbox>
                  ))}
                </Flexbox>
              ))}
            </Flexbox>
          </m.div>
        )}
      </AnimatePresence>
    </Flexbox>
  );
});

TaskDock.displayName = 'TaskDock';

export default TaskDock;
