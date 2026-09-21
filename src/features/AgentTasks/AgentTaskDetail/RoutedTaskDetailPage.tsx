'use client';

import { memo } from 'react';

import { useCanonicalTaskSlug } from '../shared/useCanonicalTaskSlug';
import TaskDetailPage from './TaskDetailPage';

interface RoutedTaskDetailPageProps {
  taskId: string;
}

/**
 * `/task/:taskId/:slug?` entry. Owns the address bar — it keeps the readable
 * slug in step with the title — which is why it wraps `TaskDetailPage` instead
 * of the shared body doing this itself: the chat Portal renders that same body
 * without owning a URL.
 */
const RoutedTaskDetailPage = memo<RoutedTaskDetailPageProps>(({ taskId }) => {
  useCanonicalTaskSlug(taskId);

  return <TaskDetailPage taskId={taskId} />;
});

RoutedTaskDetailPage.displayName = 'RoutedTaskDetailPage';

export default RoutedTaskDetailPage;
