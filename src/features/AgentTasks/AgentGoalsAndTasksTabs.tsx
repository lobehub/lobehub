import { TabsIndicator, TabsList, TabsRoot, TabsTab } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

interface AgentGoalsAndTasksTabsProps {
  agentId?: string;
  view: 'goals' | 'tasks';
}

export const AgentGoalsAndTasksTabs = memo<AgentGoalsAndTasksTabsProps>(({ agentId, view }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();

  return (
    <TabsRoot
      size={'small'}
      value={view}
      variant={'square'}
      onValueChange={(value) => navigate(agentId ? `/agent/${agentId}/${value}` : `/${value}`)}
    >
      <TabsList aria-label={t('tab.goalsAndTasks')}>
        <TabsIndicator />
        <TabsTab value={'tasks'}>{t('tab.tasks')}</TabsTab>
        <TabsTab value={'goals'}>{t('goalList.title')}</TabsTab>
      </TabsList>
    </TabsRoot>
  );
});
