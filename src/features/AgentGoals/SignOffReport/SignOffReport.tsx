'use client';

import { ActionIcon, Button, Flexbox, Skeleton, Text, useModalContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpRight, X } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { GoalDecisionAsker } from '@/features/AgentGoals/GoalDecision';
import FinalDocument from '@/features/AgentGoals/ProcessControl/FinalDocument';
import { pickFinalDeliverable } from '@/features/AgentGoals/ProcessControl/goalAcceptanceReport';
import GoalCriteriaResults from '@/features/AgentGoals/ProcessControl/GoalCriteriaResults';
import { buildGoalGraphView } from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import GoalReportPage from '@/features/AgentGoals/ProcessControl/GoalReportPage';
import {
  findFinalAcceptanceView,
  goalReportPageId,
  goalResultHeadline,
} from '@/features/AgentGoals/ProcessControl/goalResultState';
import { openRequestChangesModal } from '@/features/AgentGoals/ProcessControl/RequestChangesModal';
import { useGoalResultData } from '@/features/AgentGoals/ProcessControl/useGoalResultData';
import { goalSelectors, useGoalStore } from '@/store/goal';

import { useGoalSignOff } from './useGoalSignOff';

const styles = stylex.create({
  // The same action band as the gate report: one tinted strip the decision
  // lives in, apart from the report it decides on.
  footer: {
    alignItems: 'center',
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgElevated} 92%, ${cssVar.colorFillSecondary})`,
    borderBlockStartColor: cssVar.colorBorder,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    display: 'flex',
    gap: 12,
    paddingBlock: 12,
    paddingInline: 24,
  },
  frame: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '84vh',
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    borderBlockEndColor: cssVar.colorBorder,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    display: 'flex',
    gap: 8,
    paddingBlock: 12,
    paddingInline: 24,
  },
  // Sized by its content and shrunk to the frame's max height: a zero basis
  // in a column with no definite height collapses the report to nothing.
  scroll: {
    flexBasis: 'auto',
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    overflowY: 'auto',
    paddingBlock: 24,
    paddingInline: 24,
  },
  title: {
    fontSize: cssVar.fontSizeHeading4,
    fontWeight: 600,
    lineHeight: 1.4,
    margin: 0,
  },
});

export interface GoalSignOffReportProps {
  acceptanceId: string;
  agentId?: string | null;
  goalId: string;
  goalTitle: string;
  /** The sign-off landed either way; re-read whatever listed it. */
  onDecided?: () => Promise<unknown> | void;
  /** Leave for the goal page — the modal host sits outside the router. */
  onOpenGoal?: () => void;
}

/**
 * A finished Goal's delivery, read before it is signed off: the headline and
 * HTML report the wrap-up wrote, the document the work produced, and each
 * criterion against what the goal-level acceptance found. The decision sits in
 * the band under it, so nobody signs a delivery they have not been shown.
 */
const GoalSignOffReport = ({
  acceptanceId,
  agentId,
  goalId,
  goalTitle,
  onDecided,
  onOpenGoal,
}: GoalSignOffReportProps) => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();

  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  useFetchGoalGraph(goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));
  const graph = useMemo(() => (snapshot ? buildGoalGraphView(snapshot) : undefined), [snapshot]);

  const { accept, pending, requestChanges } = useGoalSignOff({
    acceptanceId,
    onClose: close,
    onDecided,
  });

  return (
    <div {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.header)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <GoalDecisionAsker
            agentId={agentId}
            category={'judgment'}
            subtitle={t('goalProcess.signOff.islandSubtitle')}
          />
        </div>
        {onOpenGoal && (
          <ActionIcon
            icon={ArrowUpRight}
            size={'small'}
            title={t('goalProcess.clarify.openGoal')}
            onClick={() => {
              close();
              onOpenGoal();
            }}
          />
        )}
        <ActionIcon icon={X} size={'small'} title={t('close', { ns: 'common' })} onClick={close} />
      </div>
      <div {...stylex.props(styles.scroll)}>
        <Flexbox gap={24}>
          <Flexbox gap={8}>
            <h3 {...stylex.props(styles.title)}>{goalTitle}</h3>
            <Text type={'secondary'}>{t('goalProcess.result.signOff.prompt')}</Text>
          </Flexbox>
          {graph ? (
            <DeliveryBody graph={graph} />
          ) : (
            <Flexbox gap={10}>
              <Skeleton height={24} radius={4} width={'40%'} />
              <Skeleton height={320} radius={8} />
              <Skeleton height={14} radius={4} />
              <Skeleton height={14} radius={4} width={'70%'} />
            </Flexbox>
          )}
        </Flexbox>
      </div>
      <div {...stylex.props(styles.footer)}>
        <Text style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
          {t('goalProcess.signOff.description')}
        </Text>
        <Button
          disabled={!!pending}
          loading={pending === 'changes'}
          onClick={() => openRequestChangesModal({ onConfirm: requestChanges })}
        >
          {t('goalProcess.signOff.requestChanges')}
        </Button>
        <Button
          disabled={!!pending}
          loading={pending === 'accept'}
          title={t('goalProcess.signOff.acceptEffect')}
          type={'primary'}
          onClick={accept}
        >
          {t('goalProcess.signOff.accept')}
        </Button>
      </div>
    </div>
  );
};

const DeliveryBody = ({ graph }: { graph: NonNullable<ReturnType<typeof buildGoalGraphView>> }) => {
  const data = useGoalResultData(graph);
  const headline = goalResultHeadline(graph);
  const reportPageId = goalReportPageId(graph);
  const deliverable = pickFinalDeliverable(
    graph.artifacts,
    findFinalAcceptanceView(graph)?.node.id ?? '',
  );

  return (
    <>
      {headline && (
        <Text fontSize={18} style={{ lineHeight: 1.4 }} weight={600}>
          {headline}
        </Text>
      )}
      {reportPageId && <GoalReportPage documentId={reportPageId} />}
      {deliverable && <FinalDocument documentId={deliverable.documentId} />}
      <GoalCriteriaResults
        acceptanceId={data.acceptanceId}
        error={data.error}
        loading={data.isLoading}
        outcomes={data.outcomes}
        onRetry={data.retry}
      />
    </>
  );
};

export default GoalSignOffReport;
