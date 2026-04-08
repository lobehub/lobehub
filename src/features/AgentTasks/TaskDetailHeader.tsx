import { ActionIcon, Flexbox } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { App, Button, Input } from 'antd';
import { cssVar } from 'antd-style';
import { Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { styles } from './style';
import TaskScheduleConfig from './TaskScheduleConfig';

const DEBOUNCE_MS = 300;

const TaskDetailHeader = memo(() => {
  const { t } = useTranslation('chat');
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const name = useTaskStore(taskDetailSelectors.activeTaskName);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const agentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
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
    <Flexbox gap={8}>
      <Input
        className={styles.titleInput}
        placeholder={t('taskDetail.titlePlaceholder')}
        value={localName}
        variant={'borderless'}
        onChange={handleNameChange}
      />
      <Flexbox horizontal align="center" gap={8}>
        {(canRun || canPause) && (
          <Button size="small" type={canRun ? 'primary' : 'default'} onClick={handleRunOrPause}>
            {canRun ? t('taskDetail.runTask') : t('taskDetail.pauseTask')}
          </Button>
        )}
        <TaskScheduleConfig />
        <Flexbox flex={1} />
        {taskId && (
          <ActionIcon
            icon={Trash2}
            size="small"
            style={{ color: cssVar.colorTextTertiary }}
            onClick={() => {
              modal.confirm({
                centered: true,
                content: t('taskDetail.deleteConfirm.content'),
                okButtonProps: { danger: true },
                okText: t('taskDetail.deleteConfirm.ok'),
                onOk: async () => {
                  await deleteTask(taskId);
                  if (agentId) navigate(`/agent/${agentId}/tasks`);
                },
                title: t('taskDetail.deleteConfirm.title'),
                type: 'error',
              });
            }}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default TaskDetailHeader;
