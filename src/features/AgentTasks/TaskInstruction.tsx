import { Flexbox, Markdown, Text } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { Input } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { styles } from './style';

const { TextArea } = Input;
const DEBOUNCE_MS = 300;

const TaskInstruction = memo(() => {
  const { t } = useTranslation('chat');
  const instruction = useTaskStore(taskDetailSelectors.activeTaskInstruction);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(instruction ?? '');

  // Sync from store
  if (!editing && instruction !== undefined && instruction !== localValue) {
    setLocalValue(instruction);
  }

  const { run: debouncedSave } = useDebounceFn(
    (value: string) => {
      if (taskId) updateTask(taskId, { instruction: value });
    },
    { wait: DEBOUNCE_MS },
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setLocalValue(e.target.value);
      debouncedSave(e.target.value);
    },
    [debouncedSave],
  );

  return (
    <div className={styles.section}>
      <Text className={styles.sectionTitle}>{t('taskDetail.instruction')}</Text>
      {editing ? (
        <TextArea
          autoSize={{ minRows: 4 }}
          value={localValue}
          onBlur={() => setEditing(false)}
          onChange={handleChange}
        />
      ) : (
        <Flexbox style={{ cursor: 'pointer', minHeight: 60 }} onClick={() => setEditing(true)}>
          {localValue ? (
            <Markdown variant="chat">{localValue}</Markdown>
          ) : (
            <Text type="secondary">{t('taskDetail.instructionPlaceholder')}</Text>
          )}
        </Flexbox>
      )}
    </div>
  );
});

export default TaskInstruction;
