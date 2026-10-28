// Fixture: the column's "add task" button swaps the column body for an inline composer.
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { TextArea } from '@lobehub/ui/base-ui';
import { PlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';

import TaskCard from './TaskCard';

const KanbanColumn = memo<{ status: string; taskIds: string[] }>(({ status, taskIds }) => {
  const { t } = useTranslation('chat');
  const createTask = useTaskStore((s) => s.createTask);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');

  const submit = async () => {
    const name = title.trim();
    if (!name) return;
    await createTask({ instruction: name, name, status });
    setTitle('');
    setCreating(false);
  };

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <span>{t(`taskStatus.${status}`)}</span>
        <ActionIcon
          icon={PlusIcon}
          title={t('createTask.title')}
          onClick={() => setCreating(true)}
        />
      </Flexbox>
      {creating ? (
        // alint-expect
        <TextArea
          autoFocus
          placeholder={t('createTask.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onPressEnter={() => void submit()}
        />
      ) : (
        taskIds.map((id) => <TaskCard id={id} key={id} />)
      )}
    </Flexbox>
  );
});

export default KanbanColumn;
