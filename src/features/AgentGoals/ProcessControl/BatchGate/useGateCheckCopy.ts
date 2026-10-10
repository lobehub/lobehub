import type { GoalRolloutGateCheck, GoalRolloutGateCheckKey } from '@lobechat/types';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/** A check as the gate will run it, or as a verdict recorded it. */
export type GateCheckLike = Partial<Omit<GoalRolloutGateCheck, 'key'>> & {
  key: GoalRolloutGateCheckKey;
  /** A planned external check's title, before any verdict recorded `details`. */
  title?: string;
};

/** What one gate check is called, and what it found when a verdict recorded it. */
export const useGateCheckCopy = () => {
  const { t } = useTranslation('chat');
  return useCallback(
    (check: GateCheckLike): { detail?: string; label: string } => {
      if (check.key === 'external')
        return {
          label: t('goalBatch.gateCheck.external', {
            title: check.title ?? check.details?.[0] ?? '',
          }),
        };
      const label = t(`goalBatch.gateCheck.${check.key}` as const);
      if (check.key === 'axes_covered' && check.details?.length)
        return {
          detail: t('goalBatch.gateCheck.uncovered', { values: check.details.join('、') }),
          label,
        };
      if (check.count !== undefined && check.total !== undefined)
        return {
          detail: t('goalBatch.gateCheck.count', { count: check.count, total: check.total }),
          label,
        };
      return { label };
    },
    [t],
  );
};
