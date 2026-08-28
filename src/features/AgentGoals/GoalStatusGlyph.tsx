import type { GoalStatus } from '@lobechat/const/goal';
import { Icon } from '@lobehub/ui';
import { memo } from 'react';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import RunningGlyph from '@/features/Home/components/RunningGlyph';

import { goalStatusToTaskStatus } from './goalPresentation';

/**
 * The goal surfaces' status glyph. A live goal shows the same spinning ring as
 * running task topics — animation is the "executing right now" signal shared
 * across the app — while every other state keeps its canonical static glyph
 * from `ExecutionStatus`.
 */
const GoalStatusGlyph = memo<{ size?: number; status: GoalStatus }>(({ status, size = 13 }) => {
  if (status === 'running') return <RunningGlyph size={size} />;

  const visual = TASK_STATUS_VISUALS[goalStatusToTaskStatus(status)] ?? TASK_STATUS_VISUALS.backlog;

  return <Icon color={visual.color} icon={visual.icon} size={size} style={{ flexShrink: 0 }} />;
});

export default GoalStatusGlyph;
