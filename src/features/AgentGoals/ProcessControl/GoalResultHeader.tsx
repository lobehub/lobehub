'use client';

import type { GoalGraphDecision } from '@lobechat/types';
import { Flexbox, Tooltip } from '@lobehub/ui';
import { Button, confirmModal, Text, TextArea, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowRight, CircleCheck, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { usePermission } from '@/hooks/usePermission';
import { verifyService } from '@/services/verify';
import { useGoalStore } from '@/store/goal';

import { formatSpan, formatUsd } from '../goalPresentation';
import { coordinatorGateReason, coordinatorReasonCopy } from './coordinatorCopy';
import { useGateOptionLabel } from './Frontier';
import type { GoalGraphView } from './goalGraphViewModel';
import {
  countGoalTasks,
  deriveGoalResultStatus,
  deriveSignOffState,
  findGoalAcceptanceGate,
  findOpenChangeRequest,
  type GoalAcceptanceGate,
  type GoalSignOffState,
} from './goalResultState';
import { openRequestChangesModal } from './RequestChangesModal';
import type { GoalResultData } from './useGoalResultData';

/**
 * The first screen of a finished Goal: the one-line result (only when the
 * wrap-up report wrote one), how big the run was, and the one action it waits
 * on — signing off the delivery. Sign-off is the Goal-level acceptance's own
 * accept / reject, so the acceptance page and this strip can never disagree.
 *
 * Where the result stands reads from the acceptance itself, below: 验收标准
 * says what was met, and this strip says what to do about it.
 */

const styles = createStaticStyles(({ css }) => ({
  strip: css`
    padding-block: 10px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

const SIGN_OFF_TEXT: Record<GoalSignOffState, string> = {
  accepted: 'goalProcess.result.signOff.accepted',
  changesRequested: 'goalProcess.result.signOff.changesRequested',
  open: 'goalProcess.result.signOff.prompt',
  stopped: 'goalProcess.result.signOff.stopped',
  unavailable: 'goalProcess.result.signOff.unavailable',
};

interface SignOffStripProps {
  data: GoalResultData;
  gate?: GoalAcceptanceGate['kind'];
  goalId: string;
  goalStatus: string;
  onContinue: () => void;
  partial: boolean;
}

const SignOffStrip = ({
  data,
  gate,
  goalId,
  goalStatus,
  onContinue,
  partial,
}: SignOffStripProps) => {
  const { t } = useTranslation('chat');
  const refreshGoalGraph = useGoalStore((s) => s.refreshGoalGraph);
  const { acceptanceId, acceptanceStatus, canReview, mutateAcceptance, outcomes } = data;
  const state = deriveSignOffState(acceptanceStatus, goalStatus, gate);
  const unmet = outcomes.filter((outcome) => outcome.state !== 'passed').length;

  const settle = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await Promise.all([mutateAcceptance(), refreshGoalGraph(goalId)]);
      return true;
    } catch (error) {
      console.error('[goal:sign-off]', error);
      toast.error(t('goalProcess.result.signOff.error'));
      return false;
    }
  };

  const accept = () =>
    confirmModal({
      cancelText: t('goalProcess.result.signOff.cancel'),
      content:
        unmet > 0
          ? `${t('goalProcess.result.signOff.acceptConfirm.content')} ${t(
              'goalProcess.result.signOff.acceptConfirm.unmet',
              { count: unmet },
            )}`
          : t('goalProcess.result.signOff.acceptConfirm.content'),
      okText: t('goalProcess.result.signOff.accept'),
      onOk: async () => {
        await settle(() => verifyService.acceptDelivery(acceptanceId!));
      },
      title: t('goalProcess.result.signOff.acceptConfirm.title'),
    });

  const requestChanges = () =>
    openRequestChangesModal({
      onConfirm: async (comment) => {
        const sent = await settle(() => verifyService.rejectDelivery(acceptanceId!, comment));
        if (sent) toast.success(t('goalProcess.result.signOff.changes.sent'));
        return sent;
      },
    });

  const actionable = state === 'open' && !!acceptanceId && canReview;

  // Without the bundle the page cannot tell whether a sign-off is possible;
  // say so and offer a retry rather than silently dropping the actions.
  if (data.error && state === 'open')
    return (
      <Flexbox className={styles.strip} data-sign-off-state={'error'}>
        <AsyncError error={data.error} variant={'inline'} onRetry={data.retry} />
      </Flexbox>
    );

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.strip}
      data-sign-off-state={state}
      gap={12}
      justify={'space-between'}
      wrap={'wrap'}
    >
      <Text style={{ flex: 1, minWidth: 200 }} type={state === 'open' ? undefined : 'secondary'}>
        {t(SIGN_OFF_TEXT[state] as any)}
      </Text>
      <Flexbox horizontal gap={8}>
        {actionable && (
          <>
            <Button icon={Undo2} onClick={requestChanges}>
              {t('goalProcess.result.signOff.requestChanges')}
            </Button>
            <Button icon={CircleCheck} type={'primary'} onClick={accept}>
              {t('goalProcess.result.signOff.accept')}
            </Button>
          </>
        )}
        {/* A stopped Goal has nothing further to sign; its way forward is to
            pick the work up again. */}
        {!actionable && partial && (
          <Button icon={ArrowRight} onClick={onContinue}>
            {t('goalProcess.result.unfinished.continue')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
};

interface DecisionStripProps {
  decision: GoalGraphDecision;
  goalId: string;
  onDecided: () => Promise<unknown>;
}

/**
 * The Goal-level acceptance ended unmet and the coordinator opened a gate on
 * it. The owner decides here, beside the criteria that failed, instead of
 * hunting for the gate on the 执行过程 tab — same options, same endpoint.
 */
const DecisionStrip = ({ decision, goalId, onDecided }: DecisionStripProps) => {
  const { t } = useTranslation('chat');
  const decideGoal = useGoalStore((s) => s.decideGoal);
  const { allowed: canEdit } = usePermission('create_content');
  const optionLabel = useGateOptionLabel();
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState<string>();

  const rawReason = coordinatorGateReason(decision.question);
  const reasonCopy = coordinatorReasonCopy(rawReason);
  const reason = reasonCopy ? t(reasonCopy.key as any, reasonCopy.params) : rawReason;

  const decide = async (optionId: string) => {
    setDeciding(optionId);
    try {
      await decideGoal(goalId, {
        decisionId: decision.id,
        optionId,
        resolution: note.trim() || undefined,
      });
      await onDecided();
    } catch (error) {
      console.error('[goal:result-decision]', error);
      toast.error(t('goalProcess.result.gate.error'));
    } finally {
      setDeciding(undefined);
    }
  };

  return (
    <Flexbox className={styles.strip} data-goal-result-gate={decision.id} gap={12}>
      <Flexbox gap={4}>
        {reason && <Text weight={500}>{reason}</Text>}
        <Text type={'secondary'}>{t('goalProcess.result.gate.prompt')}</Text>
      </Flexbox>
      {canEdit && (
        <>
          <TextArea
            autoSize={{ maxRows: 3, minRows: 1 }}
            placeholder={t('goalProcess.gate.notePlaceholder')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Flexbox horizontal gap={8} wrap={'wrap'}>
            {decision.options?.map((option) => (
              <Tooltip key={option.id} title={option.description}>
                <Button
                  danger={option.id === 'fail'}
                  disabled={!!deciding && deciding !== option.id}
                  loading={deciding === option.id}
                  type={option.id === decision.recommendedOptionId ? 'primary' : 'default'}
                  onClick={() => decide(option.id)}
                >
                  {optionLabel(option)}
                </Button>
              </Tooltip>
            ))}
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
};

interface GoalResultHeaderProps {
  data: GoalResultData;
  graph: GoalGraphView;
  onContinue: () => void;
}

const GoalResultHeader = ({ data, graph, onContinue }: GoalResultHeaderProps) => {
  const { t } = useTranslation('chat');
  const { goal } = graph;
  const { outcomes } = data;
  const met = outcomes.filter((outcome) => outcome.state === 'passed').length;
  const gate = findGoalAcceptanceGate(graph);
  const changeRequest = findOpenChangeRequest(graph);
  const status = deriveGoalResultStatus({
    acceptanceStatus: data.acceptanceStatus,
    changesRequested: !!changeRequest,
    gate: gate?.kind,
    goalStatus: goal.status,
    unmetCriteria: outcomes.filter((outcome) => outcome.state === 'failed').length,
  });
  const headline = graph.report?.latest?.metadata.headline;

  const scale = [
    outcomes.length > 0 && t('goalProcess.result.scale.criteria', { met, total: outcomes.length }),
    t('goalProcess.result.scale.tasks', { count: countGoalTasks(graph) }),
    goal.startedAt &&
      t('goalProcess.result.scale.duration', {
        duration: formatSpan(
          (goal.completedAt ?? goal.updatedAt).getTime() - goal.startedAt.getTime(),
        ),
      }),
    graph.spend && t('goalProcess.result.scale.cost', { cost: formatUsd(graph.spend.totalCost) }),
  ].filter(Boolean);

  return (
    <Flexbox data-goal-result-status={status} gap={14}>
      {headline && (
        <Text fontSize={20} style={{ lineHeight: 1.4 }} weight={600}>
          {headline}
        </Text>
      )}
      <Text fontSize={13} type={'secondary'}>
        {scale.join(' · ')}
      </Text>
      {status === 'awaitingDecision' && gate?.kind === 'pending' ? (
        <DecisionStrip
          decision={gate.decision}
          goalId={goal.id}
          onDecided={data.mutateAcceptance}
        />
      ) : status === 'revising' ? (
        // Nothing to sign while the rework runs: the strip says what the Agent
        // is answering to instead of offering accept / request changes again.
        <Flexbox className={styles.strip} data-sign-off-state={'revising'} gap={6}>
          <Text type={'secondary'}>
            {t(
              changeRequest
                ? 'goalProcess.result.changes.revising'
                : 'goalProcess.result.gate.revising',
            )}
          </Text>
          {changeRequest?.comment && (
            <Flexbox data-goal-change-request gap={2}>
              <Text fontSize={12} type={'secondary'} weight={500}>
                {t('goalProcess.result.changes.comment')}
              </Text>
              <Text style={{ whiteSpace: 'pre-wrap' }}>{changeRequest.comment}</Text>
            </Flexbox>
          )}
        </Flexbox>
      ) : (
        <SignOffStrip
          data={data}
          gate={gate?.kind}
          goalId={goal.id}
          goalStatus={goal.status}
          partial={status === 'partial'}
          onContinue={onContinue}
        />
      )}
    </Flexbox>
  );
};

export default GoalResultHeader;
