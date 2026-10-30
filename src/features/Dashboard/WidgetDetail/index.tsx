'use client';

import { Alert, Drawer, Flexbox, Tabs, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardWidgetItem } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import { ErrorLine } from '../ErrorLine';
import { useWidgetTrend } from '../hooks/useWidgetTrend';
import { formatSchedule } from '../utils/schedule';
import { getWidgetHealth, getWidgetUpdatedAt } from '../utils/widgetHealth';
import HealthDot, { getHealthTone, HEALTH_TONE_COLOR } from '../WidgetCard/HealthDot';
import StatusBadges from '../WidgetCard/StatusBadges';
import WidgetOutputView from '../WidgetCard/views';
import WidgetRefreshButton from '../WidgetRefreshButton';
import RunHistory from './RunHistory';
import VersionDiff from './VersionDiff';
import VersionList from './VersionList';

const styles = stylex.create({
  cell: {
    minWidth: '0',
    paddingBlock: '8px',
    paddingInline: '12px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  cellLabel: { fontSize: '12px', color: cssVar.colorTextTertiary },
  cellValue: {
    overflow: 'hidden',
    fontSize: '13px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))',
    gap: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  status: {
    paddingBlock: '6px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  summary: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
});

/**
 * One fact of the summary row: a quiet label over a short value. The exact
 * detail (full timestamps, next run) sits in the value's tooltip so the row
 * stays two lines tall.
 */
const Cell = ({
  detail,
  label,
  children,
}: {
  children: ReactNode;
  detail?: string;
  label: string;
}) => (
  <Flexbox className={stylex.props(styles.cell).className} gap={2}>
    <span className={stylex.props(styles.cellLabel).className}>{label}</span>
    <span className={stylex.props(styles.cellValue).className} title={detail}>
      {children}
    </span>
  </Flexbox>
);

const formatTime = (value?: Date | string | null) =>
  value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : undefined;

const fromNow = (value?: Date | string | null) => (value ? dayjs(value).fromNow() : undefined);

/** Freshness, schedule and live version of the widget, plus the last error. */
const WidgetSummary = memo<{ widget: DashboardWidgetItem }>(({ widget }) => {
  const { t } = useTranslation('dashboard');
  const running = useDashboardStore(dashboardSelectors.isWidgetRunning(widget.id));
  const useFetchWidgetVersions = useDashboardStore((s) => s.useFetchWidgetVersions);
  useFetchWidgetVersions(widget.id);
  const versions = useDashboardStore(dashboardSelectors.widgetVersions(widget.id));
  const published = versions.find((version) => version.id === widget.publishedVersionId);
  const draft = versions.find((version) => version.id === widget.draftVersionId);
  const health = getWidgetHealth(widget, { runningLocally: running });
  const updatedAt = getWidgetUpdatedAt(widget);
  const tone = getHealthTone(health);
  const badges = health.badges.filter((badge) => badge !== 'running');

  return (
    <Flexbox data-widget-summary gap={12}>
      <div {...stylex.props(styles.summary)}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.status).className}
          gap={8}
        >
          <HealthDot health={health} />
          <Text fontSize={13} style={{ color: HEALTH_TONE_COLOR[tone] }} weight={500}>
            {health.running
              ? t('widget.status.running')
              : badges.length > 0
                ? t(`widget.status.${badges[0]}`)
                : t('widget.status.ok')}
          </Text>
          {badges.length > 1 && <StatusBadges badges={badges.slice(1)} health={health} />}
          <Flexbox flex={1} />
          <WidgetRefreshButton widget={widget} />
        </Flexbox>
        <div className={stylex.props(styles.grid).className}>
          <Cell detail={formatTime(updatedAt)} label={t('detail.updatedAt')}>
            {fromNow(updatedAt) ?? '—'}
          </Cell>
          <Cell detail={formatTime(widget.lastRunAt)} label={t('detail.lastRunAt')}>
            {widget.lastRunAt
              ? `${fromNow(widget.lastRunAt)} · ${t(`run.status.${widget.lastRunStatus ?? 'running'}`)}`
              : '—'}
          </Cell>
          <Cell
            label={t('detail.schedule')}
            detail={
              widget.nextRunAt
                ? `${t('detail.nextRunAt')} ${formatTime(widget.nextRunAt)}`
                : undefined
            }
          >
            {widget.schedulePattern
              ? formatSchedule(t, widget.schedulePattern, widget.scheduleTimezone)
              : t('detail.manualOnly')}
          </Cell>
          <Cell label={t('detail.version')}>
            {[
              published
                ? t('detail.versionPublished', { version: published.version })
                : widget.publishedVersionId
                  ? '…'
                  : t('detail.versionNone'),
              draft && t('detail.versionDraft', { version: draft.version }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Cell>
        </div>
      </div>
      {health.failed && health.error && (
        <ErrorLine
          detail={`${health.error.code}\n${health.error.message}`}
          summary={
            widget.consecutiveFailures > 1
              ? `${t('widget.status.failed')} · ${t('detail.failures')} ${widget.consecutiveFailures}`
              : t('widget.status.failed')
          }
        />
      )}
      {health.partialMessage && (
        <Alert
          showIcon
          description={health.partialMessage}
          title={t('widget.status.partial')}
          type={'warning'}
        />
      )}
    </Flexbox>
  );
});

WidgetSummary.displayName = 'DashboardWidgetSummary';

/** The full latest output, without the card's row cap. */
const WidgetData = memo<{ widget: DashboardWidgetItem }>(({ widget }) => {
  const { t } = useTranslation('dashboard');
  const trend = useWidgetTrend(widget);

  if (!widget.latestOutput) {
    return (
      <Text fontSize={12} type={'secondary'}>
        {t('detail.noOutput')}
      </Text>
    );
  }

  return (
    // A stat fills its height with the trend, so give it room the drawer does not size.
    <div style={widget.latestOutput.type === 'stat' ? { height: 200 } : { minHeight: 120 }}>
      <WidgetOutputView density={'full'} output={widget.latestOutput} trend={trend} />
    </div>
  );
});

WidgetData.displayName = 'DashboardWidgetData';

type DetailTab = 'data' | 'diff' | 'runs' | 'versions';

export interface WidgetDetailPanelProps {
  /** Version the diff tab reviews first, e.g. the draft a conversation produced. */
  diffTargetVersionId?: string;
  widget: DashboardWidgetItem;
}

/**
 * The full drill-down of one widget — freshness summary, then full data, run
 * history with logs, versions and a version diff. Hosted by the board drawer
 * and by the chat Portal.
 */
export const WidgetDetailPanel = memo<WidgetDetailPanelProps>(({ widget, diffTargetVersionId }) => {
  const { t } = useTranslation('dashboard');
  const [tab, setTab] = useState<DetailTab>('data');

  return (
    <Flexbox data-widget-detail={widget.id} gap={16}>
      <WidgetSummary widget={widget} />
      <Tabs
        activeKey={tab}
        items={[
          { key: 'data', label: t('detail.tab.data') },
          { key: 'runs', label: t('detail.tab.runs') },
          { key: 'versions', label: t('detail.tab.versions') },
          { key: 'diff', label: t('detail.tab.diff') },
        ]}
        onChange={(key) => setTab(key as DetailTab)}
      />
      {tab === 'data' && <WidgetData widget={widget} />}
      {tab === 'runs' && <RunHistory widgetId={widget.id} />}
      {tab === 'versions' && <VersionList widgetId={widget.id} />}
      {tab === 'diff' && <VersionDiff targetVersionId={diffTargetVersionId} widgetId={widget.id} />}
    </Flexbox>
  );
});

WidgetDetailPanel.displayName = 'DashboardWidgetDetailPanel';

export interface WidgetDetailDrawerProps {
  onClose: () => void;
  /** The widget to drill into; the drawer is closed while undefined. */
  widget?: DashboardWidgetItem;
}

/** Drill-down of one widget on a board, in a drawer. */
const WidgetDetailDrawer = memo<WidgetDetailDrawerProps>(({ widget, onClose }) => (
  <Drawer
    open={!!widget}
    placement={'right'}
    title={widget?.title}
    width={'min(92vw, 640px)'}
    onClose={onClose}
  >
    {widget && (
      <Flexbox gap={16}>
        {widget.description && <Text>{widget.description}</Text>}
        <WidgetDetailPanel widget={widget} />
      </Flexbox>
    )}
  </Drawer>
));

WidgetDetailDrawer.displayName = 'DashboardWidgetDetailDrawer';

export default WidgetDetailDrawer;
