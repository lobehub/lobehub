import { TabsIndicator, TabsList, TabsRoot, TabsTab } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/** The two task collections this strip switches between, beside goals. */
export type GoalsAndTasksCollection = 'mine' | 'scheduled' | 'tasks';
export type GoalsAndTasksView = 'goals' | GoalsAndTasksCollection;

/** Tab order: the two existing tabs keep their place, scheduled tasks join after them. */
const GOALS_AND_TASKS_TABS: readonly GoalsAndTasksView[] = ['tasks', 'goals', 'scheduled'];
/** A workspace's global page leads with "My tasks", its landing tab. */
const GOALS_AND_TASKS_TABS_WITH_MINE: readonly GoalsAndTasksView[] = [
  'mine',
  ...GOALS_AND_TASKS_TABS,
];

const TAB_LABEL_KEYS = {
  goals: 'goalList.title',
  mine: 'taskList.mine.title',
  scheduled: 'tab.scheduled',
  tasks: 'tab.tasks',
} as const satisfies Record<GoalsAndTasksView, string>;

/**
 * Where a tab lives. Tasks and goals are routes; scheduled tasks are a
 * collection of the tasks route, so that tab keeps its `collection=scheduled`
 * address and every existing link to it still resolves.
 */
export const goalsAndTasksTabPath = (
  view: GoalsAndTasksView,
  agentId?: string,
  options: { showMine?: boolean } = {},
): string => {
  const base = agentId ? `/agent/${agentId}` : '';
  if (view === 'goals') return `${base}/goals`;
  if (view === 'scheduled') return `${base}/tasks?collection=scheduled`;
  // Where "My tasks" is offered it owns the bare URL, so the full list needs a param.
  return view === 'tasks' && options.showMine ? `${base}/tasks?collection=all` : `${base}/tasks`;
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
  options: { agentId?: string; showMine?: boolean; switchesCollectionInPlace?: boolean } = {},
): GoalsAndTasksTabAction =>
  next !== 'goals' && options.switchesCollectionInPlace
    ? { collection: next, type: 'collection' }
    : {
        path: goalsAndTasksTabPath(next, options.agentId, { showMine: options.showMine }),
        type: 'navigate',
      };

interface AgentGoalsAndTasksTabsProps {
  agentId?: string;
  /** Passed by the tasks page to switch between its collections in place. */
  onTaskCollectionChange?: (collection: GoalsAndTasksCollection) => void;
  /** Offers "My tasks" and names the ordinary list "All tasks" (workspace global page). */
  showMine?: boolean;
  view: GoalsAndTasksView;
}

export const AgentGoalsAndTasksTabs = memo<AgentGoalsAndTasksTabsProps>(
  ({ agentId, onTaskCollectionChange, showMine, view }) => {
    const { t } = useTranslation('chat');
    const navigate = useWorkspaceAwareNavigate();

    const handleChange = (value: string) => {
      const action = resolveGoalsAndTasksTabAction(value as GoalsAndTasksView, {
        agentId,
        showMine,
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
          {(showMine ? GOALS_AND_TASKS_TABS_WITH_MINE : GOALS_AND_TASKS_TABS).map((tab) => (
            <TabsTab key={tab} value={tab}>
              {t(showMine && tab === 'tasks' ? 'taskList.all' : TAB_LABEL_KEYS[tab])}
            </TabsTab>
          ))}
        </TabsList>
      </TabsRoot>
    );
  },
);
