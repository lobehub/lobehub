'use client';

import type { FavoriteItem, TaskStatus } from '@lobechat/types';
import { memo } from 'react';

import TaskStatusIcon from '@/features/AgentTasks/features/TaskStatusIcon';
import { FavoriteIcon } from '@/features/Favorites';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const ICON_SIZE = 16;

/**
 * Leading icon of a favorite row. A task wears its status, the way Recents
 * shows it: the open task detail wins so a change made on the page shows at
 * once, the listed status covers every other task (kept current by
 * `useTaskFavoritesRefresh`), and a task with neither (deleted, moved) keeps
 * the plain type icon.
 */
const FavoriteItemIcon = memo<{ item: FavoriteItem }>(({ item }) => {
  const isTask = item.type === 'task';
  // Only the detail open right now is kept in sync; a cached one left behind
  // after the page closed could be older than the refreshed list.
  const liveStatus = useTaskStore((s) => {
    if (!isTask) return undefined;
    const detail = taskDetailSelectors.activeTaskDetail(s);
    return detail?.id === item.targetId ? detail.status : undefined;
  });
  const status = (liveStatus ?? item.status) as TaskStatus | undefined;

  if (isTask && status) {
    // An executing task wears the animated running mark, not the static glyph.
    if (status === 'running') return <RunningGlyph size={ICON_SIZE} />;
    return <TaskStatusIcon size={ICON_SIZE} status={status} />;
  }

  return <FavoriteIcon icon={item.icon} size={ICON_SIZE} title={item.title} type={item.type} />;
});

FavoriteItemIcon.displayName = 'FavoriteItemIcon';

export default FavoriteItemIcon;
