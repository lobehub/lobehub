import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/CircleLoading';
import SkillViewer from '@/features/SkillViewer';

import type { GoalGraphView } from '../goalGraphViewModel';
import type { BatchModel, BatchRound } from '../Graph/batchModel';
import { usePlanVersions, usePlanVersionSelection } from './planVersion';

/**
 * A batch's plan, opened from its node, read as the skill it is kept as: the
 * selected version's `SKILL.md` and the skill's files, read-only since a
 * version is a record of a round.
 * Which version shows, and comparing two, live in the panel's header
 * (`PlanHeaderActions`), out of the document.
 */

interface PlanDetailProps {
  graph: GoalGraphView;
  model: BatchModel;
  round: BatchRound;
}

const PlanDetail = memo<PlanDetailProps>(({ graph, model, round }) => {
  const { t } = useTranslation('chat');
  const { selected } = usePlanVersionSelection();
  const { files, isLoading, versions } = usePlanVersions(graph, model);

  if (isLoading) return <Loading />;

  const revision = selected ?? round.planVersion;
  const current = versions.find((version) => version.revision === revision);
  const forked = model.rounds.find((item) => item.planVersion === revision)?.forked;

  return (
    <SkillViewer
      content={current?.content}
      entityId={`${model.planSkill?.id ?? model.batchId}:${revision}`}
      files={files}
      notice={
        forked && (
          <Text fontSize={12} style={{ paddingBlockStart: 12 }} type={'secondary'}>
            {t('goalBatch.planPanel.forked')}
          </Text>
        )
      }
    />
  );
});

PlanDetail.displayName = 'GoalBatchPlanDetail';

export default PlanDetail;
