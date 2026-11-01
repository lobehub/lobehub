'use client';

import { ActionIcon, Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CommandIcon, X } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { TaskListItem } from '@/store/task/slices/list/initialState';

import { useTaskSelectionStore } from './store';
import TaskBulkActionsPanel from './TaskBulkActionsPanel';

const styles = stylex.create({
  bar: {
    backgroundColor: cssVar.colorBgElevated,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 999,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: cssVar.boxShadowSecondary,
    paddingBlock: 6,
    paddingInlineEnd: 8,
    paddingInlineStart: 16,
    pointerEvents: 'auto',
  },
  overlay: {
    display: 'flex',
    insetBlockEnd: 24,
    insetInline: 0,
    justifyContent: 'center',
    pointerEvents: 'none',
    position: 'fixed',
    zIndex: 1000,
  },
});

interface TaskBulkActionBarProps {
  /** Every task of the list, to describe the selection (archived, running, …). */
  tasks: TaskListItem[];
}

/**
 * "N selected · ⌘ Actions · ✕" — floats over the list while rows are
 * selected. ⌘/Ctrl+K opens the actions panel instead of the global command
 * menu for as long as there is a selection.
 */
const TaskBulkActionBar = memo<TaskBulkActionBarProps>(({ tasks }) => {
  const { t } = useTranslation('chat');
  const count = useTaskSelectionStore((s) => s.selectedIds.length);
  const panelOpen = useTaskSelectionStore((s) => s.panelOpen);
  const setPanelOpen = useTaskSelectionStore((s) => s.setPanelOpen);
  const clear = useTaskSelectionStore((s) => s.clear);
  const progress = useTaskSelectionStore((s) => s.progress);

  useEffect(() => {
    if (count === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey || event.altKey) return;
      // Capture phase on window runs before the document-level hotkey that
      // opens the global command menu.
      event.preventDefault();
      event.stopImmediatePropagation();
      setPanelOpen(!useTaskSelectionStore.getState().panelOpen);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [count, setPanelOpen]);

  if (count === 0) return null;

  return (
    <>
      <div {...stylex.props(styles.overlay)}>
        <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.bar)}>
          <Text style={{ marginInlineEnd: 4, whiteSpace: 'nowrap' }} weight={500}>
            {progress
              ? t('taskList.bulk.progress', { done: progress.done, total: progress.total })
              : t('taskList.bulk.selected', { count })}
          </Text>
          <Button
            data-testid={'task-bulk-actions'}
            disabled={!!progress}
            icon={CommandIcon}
            loading={!!progress}
            shape={'round'}
            size={'small'}
            onClick={() => setPanelOpen(true)}
          >
            {t('taskList.bulk.actions')}
          </Button>
          <ActionIcon
            disabled={!!progress}
            icon={X}
            size={'small'}
            title={t('taskList.bulk.clear')}
            onClick={clear}
          />
        </Flexbox>
      </div>
      {panelOpen && <TaskBulkActionsPanel tasks={tasks} onClose={() => setPanelOpen(false)} />}
    </>
  );
});

TaskBulkActionBar.displayName = 'TaskBulkActionBar';

export default TaskBulkActionBar;
