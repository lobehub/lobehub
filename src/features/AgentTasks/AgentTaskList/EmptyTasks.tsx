import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { RecommendedTaskTemplates } from '@/business/client/RecommendedTaskTemplates';
import { useTaskTemplateRecommendations } from '@/business/client/useTaskTemplateRecommendations';

import { useCreateTaskAndNavigate } from '../CreateTaskModal/useCreateTaskAndNavigate';

const EMPTY_TASKS_SPM_ROOT = 'tasks.empty.task_templates';
const EMPTY_TASKS_RECOMMEND_LIMIT = 10;
const CONTENT_MAX_WIDTH = 560;

const SCROLL_CONTAINER_STYLE = {
  overflowY: 'auto',
  paddingBlockEnd: 48,
  paddingBlockStart: 24,
} as const;
const CONTENT_STYLE = { maxWidth: CONTENT_MAX_WIDTH, width: '100%' } as const;
const SUBTITLE_STYLE = { textAlign: 'center' } as const;
const DIVIDER_STYLE = { marginBlock: 0, width: '100%' } as const;
const FULL_WIDTH_STYLE = { width: '100%' } as const;

const EmptyTasks = memo(() => {
  const { t } = useTranslation('chat');
  const state = useTaskTemplateRecommendations({
    limit: EMPTY_TASKS_RECOMMEND_LIMIT,
    spmRoot: EMPTY_TASKS_SPM_ROOT,
  });
  const handleCreateTask = useCreateTaskAndNavigate();

  const showRecommendations = state.mode !== 'hidden';

  return (
    <Flexbox align={'center'} flex={1} paddingInline={16} style={SCROLL_CONTAINER_STYLE}>
      <Flexbox align={'center'} gap={24} style={CONTENT_STYLE}>
        <Flexbox align={'center'} gap={12}>
          <Icon icon={Sparkles} size={64} />
          <Text fontSize={24} weight={600}>
            {t('taskList.empty.title')}
          </Text>
          <Text style={SUBTITLE_STYLE} type={'secondary'}>
            {t('taskList.empty.subtitle')}
          </Text>
        </Flexbox>
        <Button shadow shape={'round'} size={'large'} type={'primary'} onClick={handleCreateTask}>
          {t('taskList.empty.createButton')}
        </Button>
        {showRecommendations && (
          <>
            <Divider plain style={DIVIDER_STYLE}>
              <Text fontSize={12} type={'secondary'}>
                {t('taskList.empty.templateDivider')}
              </Text>
            </Divider>
            <Flexbox style={FULL_WIDTH_STYLE}>
              <RecommendedTaskTemplates state={state} />
            </Flexbox>
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
});

EmptyTasks.displayName = 'EmptyTasks';

export default EmptyTasks;
