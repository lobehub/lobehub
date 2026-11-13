import { Alert, Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { ExperimentGradingGap } from './experimentResults';

/**
 * What still lacks a verdict, per contender. The remedy is the page's Rerun
 * button: those cases run again; nothing is re-graded in place.
 */
export const ExperimentGradingNotices = ({ gaps }: { gaps: ExperimentGradingGap[] }) => {
  const { t } = useTranslation('eval');
  if (!gaps.length) return null;
  return (
    <Flexbox gap={8}>
      {gaps.flatMap((gap) => [
        gap.judgeError > 0 && (
          <Alert
            key={`${gap.id}-judge-error`}
            title={t('lobeBench.dashboard.judgeErrors', { name: gap.name, count: gap.judgeError })}
            type={'warning'}
          />
        ),
        gap.ungraded > 0 && (
          <Alert
            key={`${gap.id}-ungraded`}
            title={t('lobeBench.dashboard.gradingGap', { name: gap.name, count: gap.ungraded })}
            type={'warning'}
          />
        ),
        gap.awaitingExternal > 0 && (
          <Alert
            key={`${gap.id}-external`}
            type={'warning'}
            title={t('lobeBench.dashboard.awaitingExternal', {
              name: gap.name,
              count: gap.awaitingExternal,
            })}
          />
        ),
      ])}
    </Flexbox>
  );
};
