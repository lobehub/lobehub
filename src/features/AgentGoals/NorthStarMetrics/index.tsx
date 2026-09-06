'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Skeleton, Tag, Text, Tooltip } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { Check, Plus, Target } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { goalSelectors, useGoalStore } from '@/store/goal';

import { openDeclareMetricModal } from './DeclareMetricModal';
import { buildNorthStarCards, formatMetricValue, type NorthStarCard } from './northStar';
import { openRecordObservationModal } from './RecordObservationModal';
import Sparkline from './Sparkline';

/**
 * The goal's north-star strip: how far the *world* is from the declared
 * numbers, above the header's execution metrics (rounds / spend / duration),
 * which only say what the run cost. Clauses come from
 * `config.acceptance.metrics` — the same numbers the coordinator's measured
 * gate reads — so the strip and the acceptance verdict can never disagree
 * about what is being tracked.
 */

const styles = createStaticStyles(({ css }) => ({
  card: css`
    flex: 1;

    min-width: 236px;
    max-width: 340px;
    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  metValue: css`
    color: ${cssVar.colorSuccess};
  `,
  stale: css`
    color: ${cssVar.colorWarning};
  `,
  track: css`
    overflow: hidden;
    height: 4px;
    border-radius: 2px;
    background: ${cssVar.colorFillSecondary};
  `,
}));

const MetricCard = memo<{ canEdit: boolean; card: NorthStarCard; goalId: string }>(
  ({ canEdit, card, goalId }) => {
    const { t } = useTranslation('chat');

    const freshness =
      card.latestAt == null
        ? t('goalProcess.northStar.unmeasured')
        : t('goalProcess.northStar.lastObserved', { time: dayjs(card.latestAt).fromNow() });

    return (
      <Flexbox className={styles.card} gap={6}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Text ellipsis fontSize={12} type={'secondary'}>
            {card.label}
          </Text>
          <Flexbox horizontal align={'center'} gap={4}>
            {card.met && (
              <Tag color={'success'} size={'small'}>
                <Icon icon={Check} size={11} /> {t('goalProcess.northStar.met')}
              </Tag>
            )}
            {/* Recording stays available after the target is met: the world
                can regress, and a card whose only refresh path disappeared
                would stay falsely met forever. */}
            {canEdit && (
              <Tooltip title={t('goalProcess.northStar.record.title')}>
                <Button
                  icon={<Icon icon={Plus} size={13} />}
                  size={'small'}
                  type={'text'}
                  onClick={() => openRecordObservationModal(goalId, card.key, card.label)}
                />
              </Tooltip>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Flexbox horizontal align={'baseline'} gap={6}>
            <Text className={card.met ? styles.metValue : ''} fontSize={20} weight={700}>
              {formatMetricValue(card.current)}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t(`goalProcess.northStar.op.${card.op}` as const)} {formatMetricValue(card.target)}
              {card.unit ? ` ${card.unit}` : ''}
            </Text>
          </Flexbox>
          <Sparkline met={card.met} values={card.trend} />
        </Flexbox>
        <div className={styles.track}>
          <div
            style={{
              background: card.met ? cssVar.colorSuccess : cssVar.colorInfo,
              borderRadius: 2,
              height: '100%',
              width: `${card.percent}%`,
            }}
          />
        </div>
        <Text className={card.stale ? styles.stale : ''} fontSize={11} type={'secondary'}>
          {freshness}
          {card.stale ? ` · ${t('goalProcess.northStar.staleWarning')}` : ''}
        </Text>
      </Flexbox>
    );
  },
);

MetricCard.displayName = 'NorthStarMetricCard';

interface NorthStarMetricsProps {
  canEdit: boolean;
  goalId: string;
}

const NorthStarMetrics = memo<NorthStarMetricsProps>(({ canEdit, goalId }) => {
  const { t } = useTranslation('chat');

  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));
  const useFetchGoalMetricSeries = useGoalStore((s) => s.useFetchGoalMetricSeries);
  const series = useGoalStore(goalSelectors.goalMetricSeries(goalId));

  const criteria = snapshot?.goal.config?.acceptance?.metrics;
  // Fetch only when there is something to join against — a goal without
  // declared clauses renders the guidance row and costs no series read.
  const { error, isLoading, mutate } = useFetchGoalMetricSeries(
    criteria?.length ? goalId : undefined,
  );

  const cards = useMemo(
    () => (criteria?.length ? buildNorthStarCards(criteria, series ?? []) : []),
    [criteria, series],
  );

  if (!criteria?.length)
    return (
      <Flexbox horizontal align={'center'} gap={12} paddingBlock={4}>
        <Icon color={cssVar.colorTextQuaternary} icon={Target} size={16} />
        <Text fontSize={13} type={'secondary'}>
          {t('goalProcess.northStar.emptyHint')}
        </Text>
        {canEdit && (
          <Button size={'small'} onClick={() => openDeclareMetricModal(goalId)}>
            {t('goalProcess.northStar.declare.title')}
          </Button>
        )}
      </Flexbox>
    );

  if (error && !series)
    return (
      <AsyncError
        error={error}
        variant={'metric'}
        onRetry={() => {
          void mutate();
        }}
      />
    );

  // First fetch still in flight: say nothing rather than confidently claiming
  // "never measured" against an empty join — a false state, not feedback.
  if (!series && isLoading)
    return (
      <Flexbox horizontal gap={10}>
        {criteria.map((criterion) => (
          <Skeleton height={96} key={criterion.key} width={236} />
        ))}
      </Flexbox>
    );

  return (
    <Flexbox horizontal gap={10} wrap={'wrap'}>
      {cards.map((card) => (
        <MetricCard canEdit={canEdit} card={card} goalId={goalId} key={card.key} />
      ))}
      {canEdit && (
        <Tooltip title={t('goalProcess.northStar.declare.title')}>
          <Button
            icon={<Icon icon={Plus} size={14} />}
            style={{ alignSelf: 'center' }}
            type={'text'}
            onClick={() => openDeclareMetricModal(goalId)}
          />
        </Tooltip>
      )}
    </Flexbox>
  );
});

NorthStarMetrics.displayName = 'NorthStarMetrics';

export default NorthStarMetrics;
