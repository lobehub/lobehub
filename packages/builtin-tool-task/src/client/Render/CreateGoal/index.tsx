'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  CheckCheck,
  CircleSlash,
  CircleX,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Stamp,
  Target,
} from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceBySubject } from '@/features/Verify';
import { acceptanceOverviewPath } from '@/features/Verify/Acceptance/routes';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import type { CreateGoalParams, CreateGoalState } from '../../../types';
import { TaskResultCard } from '../shared';

const formatElapsed = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * How the goal's live state reads on the conversation card.
 *
 * `settled` marks the states where the loop has stopped moving on its own —
 * they stop the timer and the spinner, and the row becomes a way into the
 * acceptance, because from here the next move is the user's.
 */
const PHASE_META = {
  accepted: { color: cssVar.colorSuccess, icon: CheckCheck, settled: true },
  awaitingDecision: { color: cssVar.colorError, icon: AlertTriangle, settled: true },
  awaitingReview: { color: cssVar.colorWarning, icon: Stamp, settled: true },
  closed: { color: cssVar.colorTextTertiary, icon: CircleSlash, settled: true },
  errored: { color: cssVar.colorError, icon: CircleX, settled: true },
  rejected: { color: cssVar.colorError, icon: RotateCcw, settled: false },
  repairing: { color: cssVar.colorWarning, icon: RefreshCw, settled: false },
  running: { color: cssVar.colorInfo, icon: LoaderCircle, settled: false },
  verifying: { color: cssVar.colorInfo, icon: LoaderCircle, settled: false },
} as const;

type PhaseKey = keyof typeof PHASE_META;

/** Literal keys, so a renamed or missing phase label fails type-check. */
const phaseLabel = (t: TFunction<'plugin'>, phase: PhaseKey): string => {
  switch (phase) {
    case 'accepted': {
      return t('builtins.lobe-task.goal.phase.accepted');
    }
    case 'awaitingDecision': {
      return t('builtins.lobe-task.goal.phase.awaitingDecision');
    }
    case 'awaitingReview': {
      return t('builtins.lobe-task.goal.phase.awaitingReview');
    }
    case 'closed': {
      return t('builtins.lobe-task.goal.phase.closed');
    }
    case 'errored': {
      return t('builtins.lobe-task.goal.phase.errored');
    }
    case 'rejected': {
      return t('builtins.lobe-task.goal.phase.rejected');
    }
    case 'repairing': {
      return t('builtins.lobe-task.goal.phase.repairing');
    }
    case 'verifying': {
      return t('builtins.lobe-task.goal.phase.verifying');
    }
    case 'running': {
      return t('builtins.lobe-task.goal.running');
    }
  }
};

/**
 * The card reads the acceptance aggregate directly instead of waiting for the
 * loop to push a phase onto this tool message. A push can silently never
 * arrive (it needs the task to remember which tool call spawned it); the
 * aggregate is the same record the task page and the acceptance page read, so
 * the conversation can never disagree with them.
 */
const resolvePhase = (status?: string, latestRunStatus?: string | null): PhaseKey => {
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
    case 'rejected': {
      return 'rejected';
    }
    case 'repairing': {
      return 'repairing';
    }
    case 'verifying': {
      return 'verifying';
    }
    // No aggregate yet, or one that only holds the plan: the round is still
    // producing the delivery.
    default: {
      return 'running';
    }
  }
};

const CreateGoalRender = memo<BuiltinRenderProps<CreateGoalParams, CreateGoalState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('plugin');
    const navigate = useWorkspaceAwareNavigate();
    const identifier = pluginState?.identifier;
    const [now, setNow] = useState(() => Date.now());

    const { data: acceptance, mutate } = useAcceptanceBySubject(
      'task',
      pluginState?.taskId ?? null,
    );
    const phase = resolvePhase(acceptance?.status, acceptance?.latestRunStatus);
    const meta = PHASE_META[phase];

    // The elapsed clock and the poll share one timer: both exist only while the
    // goal is still moving, and both stop the moment it settles.
    useEffect(() => {
      if (meta.settled) return;
      const timer = window.setInterval(() => {
        setNow(Date.now());
        void mutate();
      }, 1000);
      return () => window.clearInterval(timer);
    }, [meta.settled, mutate]);

    if (!pluginState?.success || !identifier) return null;

    const openAcceptance = acceptance
      ? () => navigate(acceptanceOverviewPath(acceptance.id))
      : undefined;

    return (
      <TaskResultCard
        icon={Target}
        iconColor={cssVar.colorTextSecondary}
        identifier={identifier}
        title={pluginState.name ?? args?.name}
      >
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          style={openAcceptance ? { cursor: 'pointer' } : undefined}
          onClick={openAcceptance}
        >
          <Icon
            color={meta.color}
            icon={meta.icon}
            size={15}
            spin={phase === 'running' || phase === 'verifying' || phase === 'repairing'}
          />
          <Flexbox flex={1} gap={2}>
            <Flexbox horizontal align={'center'} justify={'space-between'}>
              <Text fontSize={13}>{phaseLabel(t, phase)}</Text>
              {!meta.settled && (
                <Text code fontSize={12} type={'secondary'}>
                  {formatElapsed(now - new Date(pluginState.startedAt ?? Date.now()).getTime())}
                </Text>
              )}
            </Flexbox>
            <Text fontSize={12} type={'secondary'}>
              {meta.settled
                ? t('builtins.lobe-task.goal.settledHint')
                : t('builtins.lobe-task.goal.runningHint', { count: args?.criteria?.length ?? 0 })}
            </Text>
          </Flexbox>
        </Flexbox>
      </TaskResultCard>
    );
  },
);

CreateGoalRender.displayName = 'CreateGoalRender';

export default CreateGoalRender;
