'use client';

import type { GoalGraphDecision } from '@lobechat/types';
import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openGateReportModal } from '@/features/Acceptance/Viewer/Gate';

import { coordinatorGateReason, localizedCoordinatorReason } from './coordinatorCopy';
import { useReleaseGateDecided } from './useReleaseGateDecided';

/**
 * A held batch release, as an entry rather than an answer: the release is a
 * decision gate reviewed in its own report with the plan and the experiment
 * results, so the goal page only says what is waiting and opens the report.
 */
const ReleaseGateEntry = memo<{
  acceptanceId: string;
  decision: GoalGraphDecision;
  goalId: string;
}>(({ acceptanceId, decision, goalId }) => {
  const { t } = useTranslation('chat');
  const onDecided = useReleaseGateDecided(goalId);
  return (
    <Flexbox gap={12}>
      <Text strong>{t('goalProcess.gate.title.batchRelease')}</Text>
      <Text type={'secondary'}>
        {localizedCoordinatorReason(coordinatorGateReason(decision.question), t as any)}
      </Text>
      <Flexbox horizontal justify={'flex-end'}>
        <Button type={'primary'} onClick={() => openGateReportModal({ acceptanceId, onDecided })}>
          {t('goalProcess.gate.openReview')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

ReleaseGateEntry.displayName = 'GoalReleaseGateEntry';

export default ReleaseGateEntry;
