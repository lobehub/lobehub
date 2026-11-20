'use client';

import { Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildGoalGraphView,
  type GoalGraphView,
} from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import {
  type CriterionOutcomeState,
  goalResultHeadline,
} from '@/features/AgentGoals/ProcessControl/goalResultState';
import { useGoalResultData } from '@/features/AgentGoals/ProcessControl/useGoalResultData';
import { goalSelectors, useGoalStore } from '@/store/goal';

const STATE_ICON: Record<CriterionOutcomeState, typeof CircleCheck> = {
  failed: CircleX,
  passed: CircleCheck,
  unjudged: CircleDashed,
};

const styles = stylex.create({
  criteria: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    paddingBlockStart: 8,
  },
  failed: { color: cssVar.colorError },
  passed: { color: cssVar.colorSuccess },
  unjudged: { color: cssVar.colorTextQuaternary },
});

/**
 * What a finished goal delivered, small enough for the island: the result
 * headline the wrap-up wrote and each criterion against the goal-level
 * acceptance. The owner reads it where they are; the full report — HTML page,
 * document, evidence — is one 「查看详情」 away.
 */
const SignOffDigest = ({ goalId }: { goalId: string }) => {
  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  useFetchGoalGraph(goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));
  const graph = useMemo(() => (snapshot ? buildGoalGraphView(snapshot) : undefined), [snapshot]);

  if (!graph)
    return (
      <Flexbox gap={8}>
        <Skeleton height={18} radius={4} width={'70%'} />
        <Skeleton height={14} radius={4} />
        <Skeleton height={14} radius={4} width={'60%'} />
      </Flexbox>
    );

  return <DigestBody graph={graph} />;
};

const DigestBody = ({ graph }: { graph: GoalGraphView }) => {
  const { t } = useTranslation('chat');
  const { isLoading, outcomes } = useGoalResultData(graph);
  const headline = goalResultHeadline(graph);
  const met = outcomes.filter((outcome) => outcome.state === 'passed').length;

  return (
    <Flexbox gap={8}>
      {headline ? (
        <Text style={{ lineHeight: 1.5 }} weight={500}>
          {headline}
        </Text>
      ) : (
        <Text type={'secondary'}>{t('goalProcess.signOff.islandSummary')}</Text>
      )}
      {isLoading ? (
        <Skeleton height={14} radius={4} width={'60%'} />
      ) : (
        outcomes.length > 0 && (
          <Flexbox gap={4} {...stylex.props(styles.criteria)}>
            <Text fontSize={12} type={'secondary'}>
              {t('goalProcess.result.scale.criteria', { met, total: outcomes.length })}
            </Text>
            {outcomes.map(({ criterion, state }) => (
              <Flexbox horizontal align={'center'} gap={6} key={criterion.id}>
                <span {...stylex.props(styles[state])}>
                  <Icon icon={STATE_ICON[state]} size={14} />
                </span>
                <Text ellipsis fontSize={13}>
                  {criterion.title}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>
        )
      )}
    </Flexbox>
  );
};

export default SignOffDigest;
