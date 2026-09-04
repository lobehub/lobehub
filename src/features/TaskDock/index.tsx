import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  CheckIcon,
  ChevronDownIcon,
  CircleSlashIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
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

const styles = createStaticStyles(({ css }) => ({
  container: css`
    position: fixed;
    z-index: 100;
    inset-block-end: 24px;
    inset-inline-end: 24px;

    overflow: hidden;

    width: 340px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  groupHead: css`
    border-block-end: 1px solid ${cssVar.colorFillQuaternary};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextDescription};
    text-transform: uppercase;
    letter-spacing: 0.08em;

    background: ${cssVar.colorFillQuaternary};
  `,
  head: css`
    cursor: pointer;
    padding-block: 9px;
    padding-inline: 12px;
  `,
  headDivider: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  list: css`
    overflow-y: auto;
    max-height: 340px;
  `,
  row: css`
    &:not(:first-child) {
      border-block-start: 1px solid ${cssVar.colorFillQuaternary};
    }
  `,
}));

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
        return <Icon spin icon={LoaderCircleIcon} size={16} />;
      }
    }
  }, [status]);

  if (tasks.length === 0) return null;

  // One task speaks for itself: no header, no group gutter, just the row and
  // whatever it left behind.
  if (shape === 'solo') {
    return (
      <Flexbox className={styles.container}>
        <Item {...tasks[0]} solo />
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.container}>
      <Flexbox
        horizontal
        align={'center'}
        className={`${styles.head} ${expand ? styles.headDivider : ''}`}
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
            <Flexbox className={styles.list}>
              {groups.map((group) => (
                <Flexbox key={group.label}>
                  <Flexbox
                    horizontal
                    align={'center'}
                    className={styles.groupHead}
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
                    <Flexbox className={styles.row} key={task.id}>
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
