import { TabsIndicator, TabsList, TabsRoot, TabsTab } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/** The two task collections this strip switches between, beside goals. */
export type GoalsAndTasksCollection = 'scheduled' | 'tasks';
export type GoalsAndTasksView = 'goals' | GoalsAndTasksCollection;

/** Tab order: the two existing tabs keep their place, scheduled tasks join after them. */
const GOALS_AND_TASKS_TABS: readonly GoalsAndTasksView[] = ['tasks', 'goals', 'scheduled'];

const TAB_LABEL_KEYS = {
  goals: 'goalList.title',
  scheduled: 'tab.scheduled',
  tasks: 'tab.tasks',
} as const satisfies Record<GoalsAndTasksView, string>;

/**
 * Where a tab lives. Tasks and goals are routes; scheduled tasks are a
 * collection of the tasks route, so that tab keeps its `collection=scheduled`
 * address and every existing link to it still resolves.
 */
export const goalsAndTasksTabPath = (view: GoalsAndTasksView, agentId?: string): string => {
  const base = agentId ? `/agent/${agentId}` : '';
  if (view === 'goals') return `${base}/goals`;
  return view === 'scheduled' ? `${base}/tasks?collection=scheduled` : `${base}/tasks`;
};

export type GoalsAndTasksTabAction =
  { collection: GoalsAndTasksCollection; type: 'collection' } | { path: string; type: 'navigate' };

/**
 * What picking a tab does. On the tasks page (`switchesCollectionInPlace`) the
 * two task collections switch through the page itself, which keeps its other
 * search params and resets its own pagination; every other pick is a
 * navigation.
 */
export const resolveGoalsAndTasksTabAction = (
  next: GoalsAndTasksView,
  options: { agentId?: string; switchesCollectionInPlace?: boolean } = {},
): GoalsAndTasksTabAction =>
  next !== 'goals' && options.switchesCollectionInPlace
    ? { collection: next, type: 'collection' }
    : { path: goalsAndTasksTabPath(next, options.agentId), type: 'navigate' };

interface AgentGoalsAndTasksTabsProps {
  agentId?: string;
  /** Passed by the tasks page to switch between its collections in place. */
  onTaskCollectionChange?: (collection: GoalsAndTasksCollection) => void;
  view: GoalsAndTasksView;
}

export const AgentGoalsAndTasksTabs = memo<AgentGoalsAndTasksTabsProps>(
  ({ agentId, onTaskCollectionChange, view }) => {
    const { t } = useTranslation('chat');
    const navigate = useWorkspaceAwareNavigate();

    const handleChange = (value: string) => {
      const action = resolveGoalsAndTasksTabAction(value as GoalsAndTasksView, {
        agentId,
        switchesCollectionInPlace: !!onTaskCollectionChange,
      });
      if (action.type === 'collection') {
        onTaskCollectionChange?.(action.collection);
        return;
      }
      navigate(action.path);
    };

    return (
      <TabsRoot size={'small'} value={view} variant={'square'} onValueChange={handleChange}>
        <TabsList aria-label={t('tab.goalsAndTasks')}>
          <TabsIndicator />
          {GOALS_AND_TASKS_TABS.map((tab) => (
            <TabsTab key={tab} value={tab}>
              {t(TAB_LABEL_KEYS[tab])}
            </TabsTab>
          ))}
        </TabsList>
      </TabsRoot>
    );
  },
);
