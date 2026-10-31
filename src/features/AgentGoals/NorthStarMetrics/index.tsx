'use client';

import { SparkAreaChart } from '@lobehub/charts';
import { Button, Flexbox, Icon, Skeleton, Text, Tooltip, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { Plus, Target } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useChatStore } from '@/store/chat';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { goalSelectors, useGoalStore } from '@/store/goal';

import { handleCardKeyDown } from './cardKeyboard';
import { openDeclareMetricModal } from './DeclareMetricModal';
import moduleStyles from './index.module.css';
import MetBadge from './MetBadge';
import { buildNorthStarCards, formatMetricValue, type NorthStarCard } from './northStar';
import { openRecordObservationModal } from './RecordObservationModal';

/**
 * The goal's north-star strip: how far the *world* is from the declared
 * numbers, above the header's execution metrics (rounds / spend / duration),
 * which only say what the run cost. Clauses come from
 * `config.acceptance.metrics` — the same numbers the coordinator's measured
 * gate reads — so the strip and the acceptance verdict can never disagree
 * about what is being tracked. A card opens its clause's detail in the
 * right-hand Portal: the full trend, the observation history and the actions.
 */

const styles = stylex.create({
  card: {
    flex: '1',
    minWidth: '236px',
    maxWidth: '340px',
    paddingBlock: '12px',
    paddingInline: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    transition: 'border-color 0.2s',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '1px' },
  },
  metValue: { color: cssVar.colorSuccess },
  stale: { color: cssVar.colorWarning },
});

const MetricCard = memo<{ canEdit: boolean; card: NorthStarCard; goalId: string }>(
  ({ canEdit, card, goalId }) => {
    const { t } = useTranslation('chat');
    const pushPortalView = useChatStore((s) => s.pushPortalView);
    const openDetail = () =>
      pushPortalView({ goalId, metricKey: card.key, type: PortalViewType.GoalNorthStar });
    const theme = useTheme();

    const freshness =
      card.latestAt == null
        ? t('goalProcess.northStar.unmeasured')
        : t('goalProcess.northStar.lastObserved', { time: dayjs(card.latestAt).fromNow() });

    return (
      <Flexbox
        className={stylex.props(styles.card).className}
        gap={6}
        role={'button'}
        style={{ cursor: 'pointer' }}
        tabIndex={0}
        onClick={openDetail}
        onKeyDown={(event) => handleCardKeyDown(event, openDetail)}
      >
        <Text ellipsis fontSize={13} weight={600}>
          {card.label}
        </Text>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Flexbox horizontal align={'baseline'} gap={6}>
            <Text
              className={stylex.props(card.met && styles.metValue).className}
              fontSize={20}
              weight={700}
            >
              {formatMetricValue(card.current)}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t(`goalProcess.northStar.op.${card.op}` as const)} {formatMetricValue(card.target)}
              {card.unit ? ` ${card.unit}` : ''}
            </Text>
          </Flexbox>
          {card.trend.length > 1 && (
            <SparkAreaChart
              autoMinValue
              categories={['value', 'target']}
              className={moduleStyles.spark}
              // The chart ids its SVG gradient by the color string, so it needs a
              // literal theme color: a `var(--…)` id breaks the `url(#…)` fill.
              colors={[card.met ? theme.colorSuccess : theme.colorInfo, theme.colorTextQuaternary]}
              data={card.trend.map((value, index) => ({ index, target: card.target, value }))}
              height={24}
              index={'index'}
              showGradient={false}
              width={84}
            />
          )}
        </Flexbox>
        {/* The verdict and its freshness read together under the number; the
            action sits apart in the opposite corner, clear of the title. */}
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            {card.met && <MetBadge />}
            <Text
              ellipsis
              className={stylex.props(card.stale && styles.stale).className}
              fontSize={11}
              type={'secondary'}
            >
              {freshness}
              {card.stale ? ` · ${t('goalProcess.northStar.staleWarning')}` : ''}
            </Text>
          </Flexbox>
          {/* Recording stays available after the target is met: the world
              can regress, and a card whose only refresh path disappeared
              would stay falsely met forever. */}
          {canEdit && (
            <Tooltip title={t('goalProcess.northStar.record.title')}>
              <Button
                aria-label={t('goalProcess.northStar.record.title')}
                icon={<Icon icon={Plus} size={13} />}
                size={'small'}
                type={'text'}
                onClick={(event) => {
                  // Recording from the card must not also open the detail.
                  event.stopPropagation();
                  openRecordObservationModal(goalId, card.key, card.label);
                }}
              />
            </Tooltip>
          )}
        </Flexbox>
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
          <Button size={'small'} type={'text'} onClick={() => openDeclareMetricModal(goalId)}>
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
            aria-label={t('goalProcess.northStar.declare.title')}
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
