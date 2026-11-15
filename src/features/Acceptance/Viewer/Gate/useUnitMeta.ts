import type { GoalReleaseGateUnit } from '@lobechat/types';
import { useTranslation } from 'react-i18next';

import { formatTokens } from './gateSummary';

export const useUnitMeta = () => {
  const { t } = useTranslation('verify');
  return (unit: GoalReleaseGateUnit) =>
    [
      unit.acceptance?.checks &&
        t('acceptance.gate.unitAcceptance', {
          passed: unit.acceptance.checks.passed,
          total: unit.acceptance.checks.total,
        }),
      t('acceptance.gate.unitRuns', { count: unit.runs }),
      t('acceptance.gate.unitTokens', { tokens: formatTokens(unit.tokens) }),
    ]
      .filter(Boolean)
      .join(' · ');
};
