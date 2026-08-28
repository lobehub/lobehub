'use client';

import { Block, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
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
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceBySubject } from '@/features/Acceptance';
import { acceptanceOverviewPath } from '@/features/Acceptance/Viewer/routes';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

/**
 * The human layer of the task's two-layer state.
 *
 * `task.status` answers "should the system keep spending compute" and stays an
 * editable scheduling control. Whether the delivery is ACCEPTED is a separate
 * question with its own lifecycle — this read-only row expresses it in the same
 * top-right block, instead of a floating banner or a badge buried in the
 * acceptance section. Clicking it goes to where the decision is made.
 *
 * `delivered` alone cannot be rendered honestly: a converged delivery and a
 * budget-exhausted one both land there. The latest round's verdict (shipped
 * with the subject payload) tells them apart.
 */
const STATE_META = {
  accepted: { color: cssVar.colorSuccess, icon: CheckCheck, labelKey: 'accepted' },
  awaitingVerification: {
    color: cssVar.colorTextTertiary,
    icon: CircleDashed,
    labelKey: 'awaitingVerification',
  },
  awaitingDecision: { color: cssVar.colorError, icon: AlertTriangle, labelKey: 'awaitingDecision' },
  awaitingReview: { color: cssVar.colorWarning, icon: Stamp, labelKey: 'awaitingReview' },
  closed: { color: cssVar.colorTextTertiary, icon: CircleSlash, labelKey: 'closed' },
  errored: { color: cssVar.colorError, icon: CircleX, labelKey: 'errored' },
  rejected: { color: cssVar.colorError, icon: RotateCcw, labelKey: 'rejected' },
  repairing: { color: cssVar.colorWarning, icon: RefreshCw, labelKey: 'repairing', spin: true },
  verifying: { color: cssVar.colorInfo, icon: Loader2, labelKey: 'verifying', spin: true },
} as const;

type StateKey = keyof typeof STATE_META;

const resolveState = (status: string, latestRunStatus?: string | null): StateKey | undefined => {
  switch (status) {
    case 'accepted': {
      return 'accepted';
    }
    case 'closed': {
      return 'closed';
    }
    case 'delivered': {
      return latestRunStatus === 'passed' ? 'awaitingReview' : 'awaitingDecision';
    }
    case 'errored': {
      return 'errored';
    }
    // The checklist existing is not the same as it being checked. While the
    // round is still producing the delivery, nothing is under verification —
    // saying "verifying" here claims work that hasn't started.
    case 'pending':
    case 'planned': {
      return 'awaitingVerification';
    }
    case 'verifying': {
      return 'verifying';
    }
    case 'rejected': {
      return 'rejected';
    }
    case 'repairing': {
      return 'repairing';
    }
    default: {
      return undefined;
    }
  }
};

const TaskAcceptanceStateRow = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const taskDatabaseId = useTaskStore(taskDetailSelectors.activeTaskDatabaseId);
  const { data: acceptance } = useAcceptanceBySubject('task', taskDatabaseId ?? null);

  // No aggregate yet (verify not configured / never ran) — the row simply
  // doesn't exist. Ordinary tasks keep the exact block they have today.
  if (!acceptance) return null;

  const state = resolveState(acceptance.status, acceptance.latestRunStatus);
  if (!state) return null;

  const meta = STATE_META[state];

  return (
    <Block
      clickable
      horizontal
      align={'center'}
      gap={10}
      paddingBlock={4}
      paddingInline={8}
      title={t('taskDetail.acceptanceState.hint')}
      variant={'borderless'}
      onClick={() => navigate(acceptanceOverviewPath(acceptance.id))}
    >
      <Icon
        color={meta.color}
        icon={meta.icon}
        size={16}
        spin={'spin' in meta && meta.spin}
        style={{ flex: 'none' }}
      />
      <Text weight={500}>{t(`taskDetail.acceptanceState.${meta.labelKey}`)}</Text>
    </Block>
  );
});

TaskAcceptanceStateRow.displayName = 'TaskAcceptanceStateRow';

export default TaskAcceptanceStateRow;
