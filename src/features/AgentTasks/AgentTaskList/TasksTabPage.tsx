'use client';

import { memo } from 'react';
import { useSearchParams } from 'react-router';

import { TASK_PROJECT_PARAM } from '@/features/TaskNav/taskScope';

import AgentTasksPage from './AgentTasksPage';

/**
 * `/tasks` page. A project picked in the Tasks tab list column scopes the list
 * through `?project=<id>`; without it the page lists every task as before.
 */
const TasksTabPage = memo(() => {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get(TASK_PROJECT_PARAM) || undefined;

  return <AgentTasksPage key={projectId ?? 'all'} projectId={projectId} />;
});

TasksTabPage.displayName = 'TasksTabPage';

export default TasksTabPage;
