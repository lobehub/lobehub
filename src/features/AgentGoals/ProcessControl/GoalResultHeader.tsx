'use client';

import type { GoalGraphDecision } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Spin, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useGoalStore } from '@/store/goal';
import { shinyTextStyles } from '@/styles';

import GoalDecisionCase from '../GoalDecision';
import type { GoalGraphView } from './goalGraphViewModel';
import {
  deriveGoalResultStatus,
  findGoalAcceptanceGate,
  findOpenChangeRequest,
  goalResultHeadline,
  isGoalReportOrganizing,
} from './goalResultState';
import type { GoalResultData } from './useGoalResultData';

/**
 * The first screen of a finished Goal: the one-line result the wrap-up report
 * wrote, and — only when the Goal-level acceptance left the coordinator a gate
 * to resolve — the decision it is waiting on. Signing a delivery off belongs to
 * the acceptance itself, so this page does not carry a second copy of it.
 */

const styles = createStaticStyles(({ css }) => ({
  strip: css`
    padding-block: 10px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

interface DecisionStripProps {
  agentId?: string | null;
  decision: GoalGraphDecision;
  goalId: string;
  onDecided: () => Promise<unknown>;
}

/**
 * The Goal-level acceptance ended unmet and the coordinator opened a gate on
 * it. The owner decides here, beside the criteria that failed, instead of
 * hunting for the gate on the 执行过程 tab — the same case the goal page and
 * the island ask, on the same endpoint.
 */
const DecisionStrip = ({ agentId, decision, goalId, onDecided }: DecisionStripProps) => {
  const { t } = useTranslation('chat');
  const decideGoal = useGoalStore((s) => s.decideGoal);
  const { allowed: canEdit } = usePermission('create_content');

  const decide = async (optionId: string, resolution?: string) => {
    try {
      await decideGoal(goalId, { decisionId: decision.id, optionId, resolution });
      await onDecided();
    } catch (error) {
      console.error('[goal:result-decision]', error);
      toast.error(t('goalProcess.result.gate.error'));
      // Rethrow so the form keeps the draft and can be sent again.
      throw error;
    }
  };

  return (
    <Flexbox className={styles.strip} data-goal-result-gate={decision.id}>
      <GoalDecisionCase
        agentId={agentId}
        canAnswer={canEdit}
        category={'goalAcceptance'}
        decision={decision}
        onDecide={decide}
      />
    </Flexbox>
  );
};

interface GoalResultHeaderProps {
  data: GoalResultData;
  graph: GoalGraphView;
}

const GoalResultHeader = ({ data, graph }: GoalResultHeaderProps) => {
  const { t } = useTranslation('chat');
  const { goal } = graph;
  const { outcomes } = data;
  const gate = findGoalAcceptanceGate(graph);
  const changeRequest = findOpenChangeRequest(graph);
  const status = deriveGoalResultStatus({
    acceptanceStatus: data.acceptanceStatus,
    changesRequested: !!changeRequest,
    gate: gate?.kind,
    goalStatus: goal.status,
    unmetCriteria: outcomes.filter((outcome) => outcome.state === 'failed').length,
  });
  const organizing = isGoalReportOrganizing(graph);
  const headline = goalResultHeadline(graph);

  return (
    <Flexbox data-goal-result-status={status} gap={14}>
      {organizing ? (
        // The next wrap-up is writing this result's title. `report.latest` is
        // still the previous version, so naming it here put the old result on
        // top of the rework. Say that this one is being organized instead, with
        // the same pending animation the storyline section uses; the title
        // swaps in by itself when the run completes.
        <Flexbox horizontal align={'center'} gap={8} role={'status'}>
          <Spin size={'small'} variant={'network'} />
          <Text
            className={shinyTextStyles.shinyText}
            fontSize={20}
            style={{ lineHeight: 1.4 }}
            weight={600}
          >
            {t('goalProcess.result.headline.pending')}
          </Text>
        </Flexbox>
      ) : (
        headline && (
          <Text fontSize={20} style={{ lineHeight: 1.4 }} weight={600}>
            {headline}
          </Text>
        )
      )}
      {status === 'awaitingDecision' && gate?.kind === 'pending' && (
        <DecisionStrip
          agentId={goal.agentId}
          decision={gate.decision}
          goalId={goal.id}
          onDecided={data.mutateAcceptance}
        />
      )}
    </Flexbox>
  );
};

export default GoalResultHeader;
