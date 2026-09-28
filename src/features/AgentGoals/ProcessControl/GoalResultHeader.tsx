'use client';

import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Button, confirmModal, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowRight, BadgeCheck, CircleAlert, CircleCheck, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import CollapsibleContent from '@/components/CollapsibleContent';
import { verifyService } from '@/services/verify';
import { useGoalStore } from '@/store/goal';

import { formatSpan, formatUsd } from '../goalPresentation';
import type { GoalGraphView } from './goalGraphViewModel';
import {
  countGoalTasks,
  deriveGoalResultStatus,
  deriveSignOffState,
  type GoalResultStatus,
  type GoalSignOffState,
} from './goalResultState';
import { openRequestChangesModal } from './RequestChangesModal';
import type { GoalResultData } from './useGoalResultData';

/**
 * The first screen of a finished Goal: where it stands, the one-line result
 * (only when the wrap-up report wrote one), what was asked, how big the run
 * was, and the one action it waits on — signing off the delivery. Sign-off is
 * the Goal-level acceptance's own accept / reject, so the acceptance page and
 * this strip can never disagree.
 */

const styles = createStaticStyles(({ css }) => ({
  strip: css`
    padding-block: 10px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

const STATUS_ICON: Record<GoalResultStatus, typeof CircleCheck> = {
  awaitingSignOff: CircleCheck,
  partial: CircleAlert,
  signedOff: BadgeCheck,
};

const STATUS_COLOR: Record<GoalResultStatus, string> = {
  awaitingSignOff: cssVar.colorSuccess,
  partial: cssVar.colorWarning,
  signedOff: cssVar.colorPrimary,
};

const SIGN_OFF_TEXT: Record<GoalSignOffState, string> = {
  accepted: 'goalProcess.result.signOff.accepted',
  changesRequested: 'goalProcess.result.signOff.changesRequested',
  open: 'goalProcess.result.signOff.prompt',
  stopped: 'goalProcess.result.signOff.stopped',
  unavailable: 'goalProcess.result.signOff.unavailable',
};

interface SignOffStripProps {
  data: GoalResultData;
  goalId: string;
  goalStatus: string;
  onContinue: () => void;
  partial: boolean;
}

const SignOffStrip = ({ data, goalId, goalStatus, onContinue, partial }: SignOffStripProps) => {
  const { t } = useTranslation('chat');
  const refreshGoalGraph = useGoalStore((s) => s.refreshGoalGraph);
  const { acceptanceId, acceptanceStatus, canReview, mutateAcceptance, outcomes } = data;
  const state = deriveSignOffState(acceptanceStatus, goalStatus);
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
  const status = deriveGoalResultStatus({
    acceptanceStatus: data.acceptanceStatus,
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
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon color={STATUS_COLOR[status]} icon={STATUS_ICON[status]} size={18} />
        <Text fontSize={14} style={{ color: STATUS_COLOR[status] }} weight={600}>
          {t(`goalProcess.result.status.${status}`)}
        </Text>
      </Flexbox>
      {headline && (
        <Text fontSize={20} style={{ lineHeight: 1.4 }} weight={600}>
          {headline}
        </Text>
      )}
      {goal.requirement && (
        <Flexbox gap={4}>
          <Text fontSize={12} type={'secondary'} weight={500}>
            {t('goalProcess.result.requirement')}
          </Text>
          <CollapsibleContent maxHeight={120}>
            <Markdown fontSize={14} variant={'chat'}>
              {goal.requirement}
            </Markdown>
          </CollapsibleContent>
        </Flexbox>
      )}
      <Text fontSize={13} type={'secondary'}>
        {scale.join(' · ')}
      </Text>
      <SignOffStrip
        data={data}
        goalId={goal.id}
        goalStatus={goal.status}
        partial={status === 'partial'}
        onContinue={onContinue}
      />
    </Flexbox>
  );
};

export default GoalResultHeader;
