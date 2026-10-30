'use client';

import type { WidgetView } from '@lobechat/types';
import { Center, cssVar as runtimeCssVar, Flexbox, Icon, Spin, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { CircleDashedIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardTrendSeries, DashboardWidgetItem } from '@/services/dashboard';
import { sx } from '@/styles/sx';

import { ErrorLine } from '../ErrorLine';
import { getWidgetCardBody, getWidgetHealth, getWidgetUpdatedAt } from '../utils/widgetHealth';
import HealthDot from './HealthDot';
import StatusBadges from './StatusBadges';
import WidgetOutputView from './views';

const styles = stylex.create({
  // Header actions show while the card (a `stylex.defaultMarker()` element) is
  // hovered or running, or while focus is inside them.
  actions: {
    flex: 'none',
    opacity: {
      'default': 0,
      ':focus-within': 1,
      '@media (hover: none)': 1,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor("[data-widget-running='true']")]: 1,
    },
    transition: `opacity ${cssVar.motionDurationMid}`,
  },
  body: {
    // Views size their headline to the card (cqi / cqh) and drop details when it is short.
    containerType: 'size',
    flex: '1',
    minHeight: 0,
    overflow: 'hidden',
  },
  bodyScrollable: { overflowY: 'auto', overscrollBehavior: 'contain' },
  card: {
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: '1px',
    boxShadow: { 'default': null, ':hover': cssVar.boxShadowTertiary },
    height: '100%',
    overflow: 'hidden',
    paddingBlockEnd: '12px',
    paddingBlockStart: '14px',
    paddingInline: '16px',
    transition: `border-color ${cssVar.motionDurationMid}, box-shadow ${cssVar.motionDurationMid}`,
  },
  clickable: {
    cursor: 'pointer',
  },
  failedOutput: {
    opacity: 0.6,
  },
  footer: {
    color: cssVar.colorTextTertiary,
    flex: 'none',
    fontSize: '12px',
    minWidth: 0,
  },
  header: {
    flex: 'none',
    minHeight: '24px',
  },
  title: {
    flex: '1',
    minWidth: 0,
  },
});

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
  /** Replaces the plain title, e.g. an inline input while editing a board. */
  title?: ReactNode;
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
  ({ widget, trend, view, actions, handle, onOpen, runningLocally, className, title }) => {
    const { t } = useTranslation('dashboard');
    const health = getWidgetHealth(widget, { runningLocally });
    const updatedAt = getWidgetUpdatedAt(widget);
    const output = widget.latestOutput;
    const bodyState = getWidgetCardBody(health);
    // The running badge would repeat the spinning refresh button and the pulsing dot.
    const badges = health.badges.filter((badge) => badge !== 'running');

    // Lists and tables are the only outputs taller than their card; the rest size to it.
    const scrollable =
      bodyState === 'output' && (output?.type === 'list' || output?.type === 'table');

    let body: ReactNode;
    if (bodyState === 'output' && output) {
      body = (
        <div {...sx([health.failed && styles.failedOutput], undefined, { height: '100%' })}>
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
          <Icon color={runtimeCssVar.colorTextQuaternary} icon={CircleDashedIcon} size={20} />
          <Text fontSize={12} type={'secondary'}>
            {t(`widget.state.${bodyState === 'unpublished' ? 'unpublished' : 'noRun'}`)}
          </Text>
        </Center>
      );
    }

    return (
      <Flexbox
        {...sx([styles.card, onOpen && styles.clickable, stylex.defaultMarker()], className)}
        data-widget-id={widget.id}
        data-widget-running={health.running}
        gap={10}
        onClick={onOpen}
      >
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.header).className}
          gap={6}
        >
          {handle}
          {title ?? (
            <Text
              ellipsis
              className={stylex.props(styles.title).className}
              title={widget.title}
              weight={500}
            >
              {widget.title}
            </Text>
          )}
          <StatusBadges badges={badges} health={health} />
          {actions && (
            // Header actions must not open the drill-down.
            <Flexbox
              data-widget-actions
              horizontal
              className={stylex.props(styles.actions).className}
              gap={2}
              onClick={(event) => event.stopPropagation()}
            >
              {actions}
            </Flexbox>
          )}
        </Flexbox>
        <div {...stylex.props(styles.body, scrollable && styles.bodyScrollable)}>{body}</div>
        {updatedAt && (
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.footer).className}
            gap={6}
          >
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
