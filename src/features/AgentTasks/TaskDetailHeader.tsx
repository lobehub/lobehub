import { ActionIcon, Flexbox, Tag } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { Button, Input } from 'antd';
import { cssVar } from 'antd-style';
import { Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { styles } from './style';
import TaskScheduleConfig from './TaskScheduleConfig';

const DEBOUNCE_MS = 300;

const statusColorMap: Record<string, string> = {
  backlog: 'default',
  canceled: 'default',
  completed: 'success',
  failed: 'warning',
  paused: 'warning',
  running: 'processing',
};

const priorityLabelMap: Record<number, string> = {
  0: 'None',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

const TaskDetailHeader = memo(() => {
  const { t } = useTranslation('chat');
  const name = useTaskStore(taskDetailSelectors.activeTaskName);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus);
  const priority = useTaskStore(taskDetailSelectors.activeTaskPriority);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const canRun = useTaskStore(taskDetailSelectors.canRunActiveTask);
  const canPause = useTaskStore(taskDetailSelectors.canPauseActiveTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const runTask = useTaskStore((s) => s.runTask);
  const pauseTask = useTaskStore((s) => s.pauseTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);

  const [localName, setLocalName] = useState(name ?? '');

  useEffect(() => {
    setLocalName(name ?? '');
  }, [name]);

  const { run: debouncedSave } = useDebounceFn(
    (value: string) => {
      if (taskId) updateTask(taskId, { name: value });
    },
    { wait: DEBOUNCE_MS },
  );

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalName(e.target.value);
      debouncedSave(e.target.value);
    },
    [debouncedSave],
  );

  const handleRunOrPause = useCallback(() => {
    if (!taskId) return;
    if (canRun) runTask(taskId);
    else if (canPause) pauseTask(taskId);
  }, [taskId, canRun, canPause, runTask, pauseTask]);

  return (
    <Flexbox gap={16} paddingBlock={16}>
      {/* Title */}
      <Input
        className={styles.titleInput}
        placeholder={t('taskDetail.titlePlaceholder')}
        value={localName}
        variant={'borderless'}
        onChange={handleNameChange}
      />
      {/* Action bar */}
      <Flexbox horizontal align="center" gap={8}>
        {(canRun || canPause) && (
          <Button size="small" type={canRun ? 'primary' : 'default'} onClick={handleRunOrPause}>
            {canRun ? t('taskDetail.runTask') : t('taskDetail.pauseTask')}
          </Button>
        )}
        <TaskScheduleConfig />
        {status && <Tag color={statusColorMap[status] ?? 'default'}>{status}</Tag>}
        {priority > 0 && <Tag>{priorityLabelMap[priority] ?? `P${priority}`}</Tag>}
        <Flexbox flex={1} />
        {taskId && (
          <ActionIcon
            icon={Trash2}
            size="small"
            style={{ color: cssVar.colorTextTertiary }}
            onClick={() => deleteTask(taskId)}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default TaskDetailHeader;
