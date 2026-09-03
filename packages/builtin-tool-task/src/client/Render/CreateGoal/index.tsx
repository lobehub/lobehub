'use client';

import type { GoalStatus } from '@lobechat/const/goal';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
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

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { goalSelectors, useGoalStore } from '@/store/goal';

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
 * The card reads the goal's own lifecycle state instead of waiting for the
 * coordinator to push a phase onto this tool message. A push can silently never
 * arrive (it needs the task to remember which tool call spawned it); the goal
 * row is the same record the goal page reads, so the conversation can never
 * disagree with it.
 */
const resolvePhase = (status: GoalStatus | undefined, pendingDecisions: number): PhaseKey => {
  if (pendingDecisions > 0) return 'awaitingDecision';
  switch (status) {
    case 'achieved': {
      return 'accepted';
    }
    case 'canceled': {
      return 'closed';
    }
    case 'failed': {
      return 'errored';
    }
    // Paused means the coordinator stopped scheduling: either the user paused
    // it, or a budget ran out. Either way the next move is theirs.
    case 'paused': {
      return 'awaitingDecision';
    }
    case 'review': {
      return 'awaitingReview';
    }
    case 'verifying': {
      return 'verifying';
    }
    default: {
      return 'running';
    }
  }
};

const CreateGoalRender = memo<BuiltinRenderProps<CreateGoalParams, CreateGoalState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('plugin');
    const navigate = useWorkspaceAwareNavigate();
    const goalId = pluginState?.goalId;
    const [now, setNow] = useState(() => Date.now());

    const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
    useFetchGoalGraph(goalId);
    const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));
    const pendingDecisions =
      snapshot?.decisions.filter((decision) => decision.status === 'pending').length ?? 0;
    const phase = resolvePhase(snapshot?.goal.status, pendingDecisions);
    const meta = PHASE_META[phase];

    // Ticks the elapsed clock only. Refreshing the graph is `useFetchGoalGraph`'s
    // job and it already polls while the goal is one the server can move — doing
    // it here too meant every mounted card pulled the whole snapshot once a
    // second, and a card whose fetch had failed read as unsettled and never
    // stopped asking.
    useEffect(() => {
      if (meta.settled) return;
      const timer = window.setInterval(() => setNow(Date.now()), 1000);
      return () => window.clearInterval(timer);
    }, [meta.settled]);

    if (!pluginState?.success || !goalId) return null;

    const agentId = snapshot?.goal.agentId;
    const openGoal = agentId ? () => navigate(`/agent/${agentId}/goal/${goalId}`) : undefined;

    return (
      <TaskResultCard
        icon={Target}
        iconColor={cssVar.colorTextSecondary}
        title={snapshot?.goal.title ?? pluginState.name ?? args?.name}
      >
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          style={openGoal ? { cursor: 'pointer' } : undefined}
          onClick={openGoal}
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
