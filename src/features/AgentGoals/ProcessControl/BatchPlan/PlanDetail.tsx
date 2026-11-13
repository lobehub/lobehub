import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import Loading from '@/components/Loading/CircleLoading';
import SkillViewer from '@/features/SkillViewer';

import type { GoalGraphView } from '../goalGraphViewModel';
import type { BatchModel, BatchRound } from '../Graph/batchModel';
import { usePlanVersions, usePlanVersionSelection } from './planVersion';
import { unreadableVersions, useSkillVersion } from './skillVersions';

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
  const { files: latestFiles, isLoading, skillId, versions } = usePlanVersions(graph, model);
  const revision = selected ?? round.planVersion;
  const current = versions.find((version) => version.revision === revision);
  const {
    data: shipped,
    error,
    isLoading: isVersionLoading,
    mutate,
  } = useSkillVersion(current && skillId, revision);

  if (isLoading || isVersionLoading) return <Loading />;
  if (unreadableVersions([{ body: shipped?.content, error }]).length > 0)
    return (
      <AsyncError
        error={error}
        onRetry={() => {
          void mutate();
        }}
      />
    );

  const forked = model.rounds.find((item) => item.planVersion === revision)?.forked;

  return (
    <SkillViewer
      content={shipped?.content ?? current?.content}
      entityId={`${model.planSkill?.id ?? model.batchId}:${revision}`}
      // The package as this version shipped it, when it kept its own files.
      files={shipped?.files ?? latestFiles}
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
