'use client';

import type { GoalGraphDecision } from '@lobechat/types';
import { Flexbox, Tooltip } from '@lobehub/ui';
import { Button, Text, TextArea, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useGoalStore } from '@/store/goal';

import { coordinatorGateReason, coordinatorReasonCopy } from './coordinatorCopy';
import { useGateOptionLabel } from './Frontier';
import type { GoalGraphView } from './goalGraphViewModel';
import {
  deriveGoalResultStatus,
  findGoalAcceptanceGate,
  findOpenChangeRequest,
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
}

const GoalResultHeader = ({ data, graph }: GoalResultHeaderProps) => {
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
  const headline = graph.report?.latest?.metadata.headline;

  return (
    <Flexbox data-goal-result-status={status} gap={14}>
      {headline && (
        <Text fontSize={20} style={{ lineHeight: 1.4 }} weight={600}>
          {headline}
        </Text>
      )}
      {status === 'awaitingDecision' && gate?.kind === 'pending' && (
        <DecisionStrip
          decision={gate.decision}
          goalId={goal.id}
          onDecided={data.mutateAcceptance}
        />
      )}
    </Flexbox>
  );
};

export default GoalResultHeader;
