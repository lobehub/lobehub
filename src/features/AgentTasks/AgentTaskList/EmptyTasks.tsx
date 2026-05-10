import { Button, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Sparkles } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { RecommendedTaskTemplates } from '@/business/client/RecommendedTaskTemplates';
import { useTaskTemplateRecommendations } from '@/business/client/useTaskTemplateRecommendations';

import { createTaskModal } from '../CreateTaskModal';

const EMPTY_TASKS_SPM_ROOT = 'tasks.empty.task_templates';
const CONTENT_MAX_WIDTH = 560;

const EmptyTasks = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const state = useTaskTemplateRecommendations({ spmRoot: EMPTY_TASKS_SPM_ROOT });

  const handleCreateTask = useCallback(() => {
    createTaskModal({
      onCreated: (task) => {
        navigate(`/task/${task.identifier}`);
      },
    });
  }, [navigate]);

  return (
    <Center flex={1} paddingBlock={48} paddingInline={16} width={'100%'}>
      <Flexbox align={'center'} gap={24} style={{ maxWidth: CONTENT_MAX_WIDTH, width: '100%' }}>
        <Flexbox align={'center'} gap={12}>
          <Icon icon={Sparkles} size={64} />
          <Text fontSize={24} weight={600}>
            {t('taskList.empty.title')}
          </Text>
          <Text style={{ textAlign: 'center' }} type={'secondary'}>
            {t('taskList.empty.subtitle')}
          </Text>
        </Flexbox>
        {state.mode === 'hidden' ? (
          <Button shadow shape={'round'} type={'primary'} onClick={handleCreateTask}>
            {t('taskList.empty.createButton')}
          </Button>
        ) : (
          <Flexbox style={{ width: '100%' }}>
            <RecommendedTaskTemplates state={state} />
          </Flexbox>
        )}
      </Flexbox>
    </Center>
  );
});

EmptyTasks.displayName = 'EmptyTasks';

export default EmptyTasks;
