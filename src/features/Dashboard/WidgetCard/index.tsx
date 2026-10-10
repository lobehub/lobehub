'use client';

import type { WidgetView } from '@lobechat/types';
import { Center, createStaticStyles, cssVar, cx,Flexbox, Icon, Spin, Text, Tooltip   } from '@lobehub/ui';
import dayjs from 'dayjs';
import { CircleDashedIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardTrendSeries, DashboardWidgetItem } from '@/services/dashboard';

import { ErrorLine } from '../ErrorLine';
import { getWidgetCardBody, getWidgetHealth, getWidgetUpdatedAt } from '../utils/widgetHealth';
import HealthDot from './HealthDot';
import StatusBadges from './StatusBadges';
import WidgetOutputView from './views';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    flex: none;
    opacity: 0;
    transition: opacity ${cssVar.motionDurationMid};

    &:focus-within {
      opacity: 1;
    }

    @media (hover: none) {
      opacity: 1;
    }
  `,
  body: css`
    /* Views size their headline to the card (cqi / cqh) and drop details when it is short. */
    container-type: size;
    overflow: hidden;
    flex: 1;
    min-height: 0;
  `,
  card: css`
    overflow: hidden;

    height: 100%;
    padding-block: 14px 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition:
      border-color ${cssVar.motionDurationMid},
      box-shadow ${cssVar.motionDurationMid};

    &:hover {
      border-color: ${cssVar.colorBorder};
      box-shadow: ${cssVar.boxShadowTertiary};
    }

    &:hover [data-widget-actions],
    &[data-widget-running='true'] [data-widget-actions] {
      opacity: 1;
    }
  `,
  clickable: css`
    cursor: pointer;
  `,
  failedOutput: css`
    opacity: 0.6;
  `,
  footer: css`
    flex: none;
    min-width: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  header: css`
    flex: none;
    min-height: 24px;
  `,
  title: css`
    flex: 1;
    min-width: 0;
  `,
}));

export interface WidgetCardProps {
  /** Header actions (refresh, menu) — a slot so read-only hosts mount none. */
  actions?: ReactNode;
  className?: string;
  /** Leading header node, e.g. a drag handle while editing a board layout. */
  handle?: ReactNode;
  /** Open the drill-down. The card is not clickable without it. */
  onOpen?: () => void;
  /** A manual refresh of this widget is in flight from this client. */
  runningLocally?: boolean;
  /** Long-term trend from `metric_points`, when the host loaded it. */
  trend?: DashboardTrendSeries[];
  view?: WidgetView | null;
  widget: DashboardWidgetItem;
}

/**
 * One widget on a board: its latest successful output, how fresh it is, and
 * whether the last attempt worked.
 *
 * A failed run never blanks the card or turns the value into 0 — the last
 * good output stays, dimmed, under a failed badge. With no good output at all
 * the card says so instead of rendering an empty value.
 */
const WidgetCard = memo<WidgetCardProps>(
  ({ widget, trend, view, actions, handle, onOpen, runningLocally, className }) => {
    const { t } = useTranslation('dashboard');
    const health = getWidgetHealth(widget, { runningLocally });
    const updatedAt = getWidgetUpdatedAt(widget);
    const output = widget.latestOutput;
    const bodyState = getWidgetCardBody(health);
    // The running badge would repeat the spinning refresh button and the pulsing dot.
    const badges = health.badges.filter((badge) => badge !== 'running');

    let body: ReactNode;
    if (bodyState === 'output' && output) {
      body = (
        <div className={cx(health.failed && styles.failedOutput)} style={{ height: '100%' }}>
          <WidgetOutputView output={output} trend={trend} view={view} />
        </div>
      );
    } else if (bodyState === 'firstRun') {
      body = (
        <Center gap={8} height={'100%'}>
          <Spin size={'small'} />
          <Text fontSize={12} type={'secondary'}>
            {t('widget.state.firstRun')}
          </Text>
        </Center>
      );
    } else if (bodyState === 'failedNoOutput') {
      body = (
        <Center data-widget-state={'failed-no-output'} height={'100%'} padding={8}>
          <ErrorLine detail={health.error?.message} summary={t('widget.state.failedNoOutput')} />
        </Center>
      );
    } else {
      body = (
        <Center gap={6} height={'100%'} padding={8}>
          <Icon color={cssVar.colorTextQuaternary} icon={CircleDashedIcon} size={20} />
          <Text fontSize={12} type={'secondary'}>
            {t(`widget.state.${bodyState === 'unpublished' ? 'unpublished' : 'noRun'}`)}
          </Text>
        </Center>
      );
    }

    return (
      <Flexbox
        className={cx(styles.card, onOpen && styles.clickable, className)}
        data-widget-id={widget.id}
        data-widget-running={health.running}
        gap={10}
        onClick={onOpen}
      >
        <Flexbox horizontal align={'center'} className={styles.header} gap={6}>
          {handle}
          <Text ellipsis className={styles.title} title={widget.title} weight={500}>
            {widget.title}
          </Text>
          <StatusBadges badges={badges} health={health} />
          {actions && (
            // Header actions must not open the drill-down.
            <Flexbox
              data-widget-actions
              horizontal
              className={styles.actions}
              gap={2}
              onClick={(event) => event.stopPropagation()}
            >
              {actions}
            </Flexbox>
          )}
        </Flexbox>
        <div className={styles.body}>{body}</div>
        {updatedAt && (
          <Flexbox horizontal align={'center'} className={styles.footer} gap={6}>
            <HealthDot health={health} />
            <Tooltip title={dayjs(updatedAt).format('YYYY-MM-DD HH:mm:ss')}>
              <span data-widget-updated>
                {output
                  ? t('widget.updatedAt', { time: dayjs(updatedAt).fromNow() })
                  : t('widget.lastAttemptAt', { time: dayjs(updatedAt).fromNow() })}
              </span>
            </Tooltip>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

WidgetCard.displayName = 'DashboardWidgetCard';

export default WidgetCard;
