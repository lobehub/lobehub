import { cssVar } from '@lobehub/ui';
import {
  AlertTriangle,
  CheckCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Loader2,
  RefreshCw,
  RotateCcw,
  Stamp,
} from 'lucide-react';

import { useAcceptanceBySubject } from '@/features/Acceptance';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import {
  resolveTaskAcceptanceState,
  type TaskAcceptanceStateKey,
} from './resolveTaskAcceptanceState';

/**
 * The human layer of the task's two-layer state.
 *
 * `task.status` answers "should the system keep spending compute" and stays an
 * editable scheduling control. Whether the delivery is ACCEPTED is a separate
 * question with its own lifecycle, read from the task's acceptance aggregate.
 *
 * `delivered` alone cannot be rendered honestly: a converged delivery and a
 * budget-exhausted one both land there. The latest round's verdict (shipped
 * with the subject payload) tells them apart.
 */
export const ACCEPTANCE_STATE_META = {
  accepted: { color: cssVar.colorSuccess, icon: CheckCheck, labelKey: 'accepted' },
  awaitingDecision: { color: cssVar.colorError, icon: AlertTriangle, labelKey: 'awaitingDecision' },
  awaitingReview: { color: cssVar.colorWarning, icon: Stamp, labelKey: 'awaitingReview' },
  awaitingVerification: {
    color: cssVar.colorTextTertiary,
    icon: CircleDashed,
    labelKey: 'awaitingVerification',
  },
  closed: { color: cssVar.colorTextTertiary, icon: CircleSlash, labelKey: 'closed' },
  errored: { color: cssVar.colorError, icon: CircleX, labelKey: 'errored' },
  rejected: { color: cssVar.colorError, icon: RotateCcw, labelKey: 'rejected' },
  repairing: { color: cssVar.colorWarning, icon: RefreshCw, labelKey: 'repairing', spin: true },
  verifying: { color: cssVar.colorInfo, icon: Loader2, labelKey: 'verifying', spin: true },
} as const satisfies Record<TaskAcceptanceStateKey, unknown>;

export interface TaskAcceptanceState {
  acceptanceId: string;
  state: TaskAcceptanceStateKey;
}

/**
 * The active task's acceptance state, or `undefined` while it has none: no
 * aggregate yet (verify not configured / never ran), or a recurring task, which
 * has no delivery to accept.
 */
export const useTaskAcceptanceState = (): TaskAcceptanceState | undefined => {
  const taskDatabaseId = useTaskStore(taskDetailSelectors.activeTaskDatabaseId);
  const automationMode = useTaskStore(taskDetailSelectors.activeTaskAutomationMode);
  const { data: acceptance } = useAcceptanceBySubject(
    'task',
    automationMode ? null : (taskDatabaseId ?? null),
  );

  if (!acceptance) return undefined;

  const state = resolveTaskAcceptanceState(acceptance.status, acceptance.latestRunStatus);
  if (!state) return undefined;

  return { acceptanceId: acceptance.id, state };
};
