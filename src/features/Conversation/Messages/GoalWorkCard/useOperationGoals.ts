import type { AssistantContentBlock } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { dataSelectors, useConversationStore } from '../../store';
import { deriveOperationGoals, type OperationGoal } from './deriveOperationGoals';

/**
 * Display-only Goal artifacts derived from one settled assistant group.
 *
 * Goals whose task already delivered its `role='taskCallback'` handoff into
 * this thread are dropped: the callback card absorbs the Goal status header
 * and becomes the single surface for that task, so the creating turn's
 * tracker card retires instead of duplicating it.
 */
export const useOperationGoals = (blocks?: AssistantContentBlock[]): OperationGoal[] => {
  const landedTaskIds = useConversationStore(dataSelectors.taskCallbackTaskIds, isEqual);

  return useMemo(
    () => deriveOperationGoals(blocks ?? []).filter((goal) => !landedTaskIds.includes(goal.taskId)),
    [blocks, landedTaskIds],
  );
};
