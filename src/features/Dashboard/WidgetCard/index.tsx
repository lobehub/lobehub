'use client';

import type { WidgetView } from '@lobechat/types';
import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Spin, Text, Tooltip } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import { AlertTriangleIcon, CircleDashedIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardTrendSeries, DashboardWidgetItem } from '@/services/dashboard';

import { getWidgetCardBody, getWidgetHealth, getWidgetUpdatedAt } from '../utils/widgetHealth';
import StatusBadges from './StatusBadges';
import WidgetOutputView from './views';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: hidden;
    flex: 1;
    min-height: 0;
  `,
  card: css`
    overflow: hidden;

    height: 100%;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  clickable: css`
    cursor: pointer;
    transition: border-color ${cssVar.motionDurationFast};

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  failedOutput: css`
    opacity: 0.72;
  `,
  header: css`
    flex: none;
    min-height: 24px;
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
        <Center data-widget-state={'failed-no-output'} gap={6} height={'100%'} padding={8}>
          <Icon color={cssVar.colorError} icon={AlertTriangleIcon} size={20} />
          <Text fontSize={12} type={'secondary'}>
            {t('widget.state.failedNoOutput')}
          </Text>
          {health.error?.message && (
            <Text ellipsis={{ rows: 2 }} fontSize={12} type={'danger'}>
              {health.error.message}
            </Text>
          )}
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
        gap={8}
        onClick={onOpen}
      >
        <Flexbox horizontal align={'center'} className={styles.header} gap={6}>
          {handle}
          <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
            {widget.title}
          </Text>
          <StatusBadges health={health} />
          {actions && (
            // Header actions must not open the drill-down.
            <Flexbox horizontal gap={2} onClick={(event) => event.stopPropagation()}>
              {actions}
            </Flexbox>
          )}
        </Flexbox>
        <div className={styles.body}>{body}</div>
        {updatedAt && (
          <Tooltip title={dayjs(updatedAt).format('YYYY-MM-DD HH:mm:ss')}>
            <Text data-widget-updated fontSize={11} type={'secondary'}>
              {output
                ? t('widget.updatedAt', { time: dayjs(updatedAt).fromNow() })
                : t('widget.lastAttemptAt', { time: dayjs(updatedAt).fromNow() })}
            </Text>
          </Tooltip>
        )}
      </Flexbox>
    );
  },
);

WidgetCard.displayName = 'DashboardWidgetCard';

export default WidgetCard;
