'use client';

import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SolveParams, SolverCandidate, SolverStatus } from '../../../types';
import { formatCost } from '../../utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  day: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  divider: css`
    height: 1px;
    background: ${cssVar.colorFillSecondary};
  `,
  label: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  toggle: css`
    cursor: pointer;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));

const TRANSPORT_MODES: [RegExp, string][] = [
  [/flight/i, 'flight'],
  [/self-driving/i, 'self-driving'],
  [/taxi/i, 'taxi'],
];

const transportMode = (raw: string): string => {
  for (const [pattern, mode] of TRANSPORT_MODES) {
    if (pattern.test(raw)) return mode;
  }
  return raw.split(',')[0] || raw;
};

/** True when the plan looks like a travelplanner day-by-day trip plan. */
const isTripPlan = (plan: Record<string, any>[]): boolean =>
  Array.isArray(plan) && plan.some((day) => typeof day?.current_city === 'string');

interface CandidateCardProps {
  candidate: SolverCandidate;
  index: number;
  showTimeoutBadge: boolean;
  spec?: SolveParams['spec'];
}

const COST_LABEL_KEYS = {
  accommodation: 'builtins.builtin-solver.render.cost.accommodation',
  meals: 'builtins.builtin-solver.render.cost.meals',
  transportation: 'builtins.builtin-solver.render.cost.transportation',
} as const;

const CandidateCard = memo<CandidateCardProps>(({ candidate, index, spec, showTimeoutBadge }) => {
  const { t } = useTranslation('plugin');
  const [showItinerary, setShowItinerary] = useState(false);

  const plan = candidate.plan ?? [];
  const budget = typeof spec?.budget === 'number' ? (spec.budget as number) : undefined;
  const totalCost = candidate.totalCost;
  const withinBudget =
    typeof budget === 'number' && typeof totalCost === 'number' ? totalCost <= budget : undefined;

  // travelplanner key facts (guarded — other packs fall through to cost only)
  const tripPlan = isTripPlan(plan);
  const cities = tripPlan
    ? plan.filter((day) => day.days % 2 === 0).map((day) => day.current_city as string)
    : [];
  const origin = typeof spec?.origin === 'string' ? (spec.origin as string) : undefined;
  const transports = tripPlan
    ? [
        ...new Set(
          plan
            .map((day) => day.transportation as string)
            .filter((leg) => leg && leg !== '-')
            .map(transportMode),
        ),
      ]
    : [];
  const stays = tripPlan
    ? [...new Set(plan.map((day) => day.accommodation as string).filter((a) => a && a !== '-'))]
    : [];

  // Hard constraints the solver guaranteed — derived from the submitted spec
  const satisfied: string[] = [];
  if (typeof budget === 'number') satisfied.push(`budget ≤ ${formatCost(budget)}`);
  if (Array.isArray(spec?.cuisines))
    for (const cuisine of spec.cuisines) satisfied.push(`cuisine: ${cuisine}`);
  if (spec?.roomType) satisfied.push(`room type: ${spec.roomType}`);
  if (spec?.houseRule) satisfied.push(`house rule: ${spec.houseRule}`);
  if (spec?.transportation) satisfied.push(String(spec.transportation));

  return (
    <Flexbox gap={6}>
      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        <Tag>{t('builtins.builtin-solver.render.candidate', { index: index + 1 })}</Tag>
        {typeof totalCost === 'number' && (
          <Text style={{ fontWeight: 500 }}>{formatCost(totalCost)}</Text>
        )}
        {withinBudget !== undefined && (
          <Text as={'span'} className={styles.label}>
            / {formatCost(budget)}{' '}
            {withinBudget
              ? t('builtins.builtin-solver.render.withinBudget')
              : t('builtins.builtin-solver.render.overBudget')}
          </Text>
        )}
        {showTimeoutBadge && (
          <Tag color={'warning'}>{t('builtins.builtin-solver.render.timeoutBadge')}</Tag>
        )}
      </Flexbox>

      {tripPlan && (
        <Flexbox gap={2}>
          {origin && cities.length > 0 && (
            <Text className={styles.label}>
              {t('builtins.builtin-solver.render.route')}: {[origin, ...cities, origin].join(' → ')}{' '}
              · {t('builtins.builtin-solver.render.days', { count: plan.length })}
            </Text>
          )}
          {transports.length > 0 && (
            <Text className={styles.label}>
              {t('builtins.builtin-solver.render.transport')}: {transports.join(', ')}
            </Text>
          )}
          {stays.length > 0 && (
            <Text className={styles.label}>
              {t('builtins.builtin-solver.render.stay')}: {stays.join(' · ')}
            </Text>
          )}
        </Flexbox>
      )}

      {candidate.costBreakdown && (
        <Text className={styles.label}>
          {Object.entries(candidate.costBreakdown)
            .filter(([key]) => key !== 'total')
            .map(([key, value]) => {
              const labelKey =
                key in COST_LABEL_KEYS
                  ? COST_LABEL_KEYS[key as keyof typeof COST_LABEL_KEYS]
                  : undefined;
              return `${labelKey ? t(labelKey) : key} ${formatCost(value)}`;
            })
            .join(' · ')}
        </Text>
      )}

      {satisfied.length > 0 && (
        <Flexbox horizontal align={'center'} gap={4} wrap={'wrap'}>
          <Text as={'span'} className={styles.label}>
            {t('builtins.builtin-solver.render.satisfiedConstraints')}:
          </Text>
          {satisfied.map((item) => (
            <Tag key={item} style={{ marginInlineEnd: 0 }}>
              {item}
            </Tag>
          ))}
        </Flexbox>
      )}

      {tripPlan && (
        <>
          <span
            className={styles.toggle}
            role={'button'}
            onClick={() => setShowItinerary((v) => !v)}
          >
            {showItinerary ? '▾' : '▸'} {t('builtins.builtin-solver.render.itinerary')}
          </span>
          {showItinerary && (
            <Flexbox gap={2}>
              {plan.map((day) => (
                <Text className={styles.day} key={day.days}>
                  {t('builtins.builtin-solver.render.day', { day: day.days })} — {day.current_city}
                  {day.transportation && day.transportation !== '-'
                    ? ` · ${day.transportation}`
                    : ''}
                  {day.accommodation && day.accommodation !== '-'
                    ? ` · ${t('builtins.builtin-solver.render.stay')}: ${day.accommodation}`
                    : ''}
                </Text>
              ))}
            </Flexbox>
          )}
        </>
      )}
    </Flexbox>
  );
});
CandidateCard.displayName = 'CandidateCard';

export interface CandidateListProps {
  candidates: SolverCandidate[];
  spec?: SolveParams['spec'];
  status: SolverStatus;
}

const CandidateList = memo<CandidateListProps>(({ candidates, spec, status }) => {
  const showTimeoutBadge = status === 'feasible_timeout';
  return (
    <Flexbox gap={12}>
      {candidates.map((candidate, index) => (
        <Flexbox gap={12} key={index}>
          {index > 0 && <div className={styles.divider} />}
          <CandidateCard
            candidate={candidate}
            index={index}
            showTimeoutBadge={showTimeoutBadge}
            spec={spec}
          />
        </Flexbox>
      ))}
    </Flexbox>
  );
});
CandidateList.displayName = 'CandidateList';

export default CandidateList;
