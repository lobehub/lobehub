import type { AssistantContentBlock } from '@lobechat/types';
import { useMemo } from 'react';

import { deriveOperationGoals, type OperationGoal } from './deriveOperationGoals';

/** Display-only Goal artifacts derived from one settled assistant group. */
export const useOperationGoals = (blocks?: AssistantContentBlock[]): OperationGoal[] =>
  useMemo(() => deriveOperationGoals(blocks ?? []), [blocks]);
