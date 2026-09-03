import type { AssistantContentBlock } from '@lobechat/types';
import { useMemo } from 'react';

import { deriveOperationGoals, type OperationGoal } from './deriveOperationGoals';

/**
 * Display-only Goal artifacts derived from one settled assistant group.
 *
 * The card tracks the goal itself, not one of the tasks its coordinator
 * dispatches, so it stays for the whole life of the goal — a Goal Task
 * finishing is progress inside the goal, not the end of it.
 */
export const useOperationGoals = (blocks?: AssistantContentBlock[]): OperationGoal[] =>
  useMemo(() => deriveOperationGoals(blocks ?? []), [blocks]);
