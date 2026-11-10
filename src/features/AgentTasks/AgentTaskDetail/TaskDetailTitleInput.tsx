import { TextArea } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const DEBOUNCE_MS = 300;

const TaskDetailTitleInput = memo(() => {
  const { t } = useTranslation('chat');
  const { allowed: canEditTask } = usePermission('create_content');
  const name = useTaskStore(taskDetailSelectors.activeTaskName);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [localName, setLocalName] = useState(name ?? '');

  useEffect(() => {
    setLocalName(name ?? '');
  }, [name]);

  const { run: debouncedSave } = useDebounceFn(
    (value: string) => {
      if (!canEditTask) return;
      if (taskId) updateTask(taskId, { name: value });
    },
    { wait: DEBOUNCE_MS },
  );

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setLocalName(e.target.value);
      debouncedSave(e.target.value);
    },
    [debouncedSave],
  );

  return (
    <TextArea
      autoSize={{ minRows: 1 }}
      disabled={!canEditTask}
      placeholder={t('taskDetail.titlePlaceholder')}
      style={{ padding: 0 }}
      value={localName}
      variant={'borderless'}
      styles={{
        input: { fontSize: 24, fontWeight: 600, lineHeight: 1.3, minHeight: 'auto' },
      }}
      onChange={handleNameChange}
    />
  );
});

export default TaskDetailTitleInput;
