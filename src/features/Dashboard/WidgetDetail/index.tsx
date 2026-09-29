'use client';

import { Flexbox } from '@lobehub/ui';
import { Drawer, Tabs, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardWidgetItem } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import { useWidgetTrend } from '../hooks/useWidgetTrend';
import { getWidgetHealth, getWidgetUpdatedAt } from '../utils/widgetHealth';
import StatusBadges from '../WidgetCard/StatusBadges';
import WidgetOutputView from '../WidgetCard/views';
import WidgetRefreshButton from '../WidgetRefreshButton';
import RunHistory from './RunHistory';
import VersionList from './VersionList';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    flex: none;
    width: 96px;
    color: ${cssVar.colorTextTertiary};
  `,
  summary: css`
    padding: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

const Row = ({ label, children }: { children: ReactNode; label: string }) => (
  <Flexbox horizontal align={'baseline'} gap={8}>
    <Text className={styles.label} fontSize={12}>
      {label}
    </Text>
    <Text fontSize={12} style={{ flex: 1, minWidth: 0 }}>
      {children}
    </Text>
  </Flexbox>
);

const formatTime = (value?: Date | string | null) =>
  value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : undefined;

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

  return (
    <Flexbox data-widget-summary className={styles.summary} gap={6}>
      <Flexbox horizontal align={'center'} gap={6}>
        <StatusBadges health={health} />
        {health.badges.length === 0 && (
          <Text fontSize={12} type={'success'}>
            {t('widget.status.ok')}
          </Text>
        )}
        <Flexbox flex={1} />
        <WidgetRefreshButton widget={widget} />
      </Flexbox>
      <Row label={t('detail.updatedAt')}>{formatTime(updatedAt) ?? '—'}</Row>
      <Row label={t('detail.lastRunAt')}>
        {widget.lastRunAt
          ? `${formatTime(widget.lastRunAt)} · ${t(`run.status.${widget.lastRunStatus ?? 'running'}`)}`
          : '—'}
      </Row>
      <Row label={t('detail.schedule')}>
        {widget.schedulePattern
          ? [widget.schedulePattern, widget.scheduleTimezone].filter(Boolean).join(' · ')
          : t('detail.manualOnly')}
      </Row>
      {widget.nextRunAt && <Row label={t('detail.nextRunAt')}>{formatTime(widget.nextRunAt)}</Row>}
      <Row label={t('detail.version')}>
        {published
          ? t('detail.versionPublished', { version: published.version })
          : widget.publishedVersionId
            ? '…'
            : t('detail.versionNone')}
        {draft && ` · ${t('detail.versionDraft', { version: draft.version })}`}
      </Row>
      {widget.consecutiveFailures > 0 && (
        <Row label={t('detail.failures')}>{widget.consecutiveFailures}</Row>
      )}
      {health.failed && health.error && (
        <Row label={t('run.error')}>
          <Text fontSize={12} type={'danger'}>
            {`[${health.error.code}] ${health.error.message}`}
          </Text>
        </Row>
      )}
      {health.partialMessage && (
        <Row label={t('widget.status.partial')}>{health.partialMessage}</Row>
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
    <div style={{ minHeight: 120 }}>
      <WidgetOutputView density={'full'} output={widget.latestOutput} trend={trend} />
    </div>
  );
});

WidgetData.displayName = 'DashboardWidgetData';

type DetailTab = 'data' | 'runs' | 'versions';

export interface WidgetDetailDrawerProps {
  onClose: () => void;
  /** The widget to drill into; the drawer is closed while undefined. */
  widget?: DashboardWidgetItem;
}

/** Drill-down of one widget: full data, run history with logs, and versions. */
const WidgetDetailDrawer = memo<WidgetDetailDrawerProps>(({ widget, onClose }) => {
  const { t } = useTranslation('dashboard');
  const [tab, setTab] = useState<DetailTab>('data');

  return (
    <Drawer
      open={!!widget}
      placement={'right'}
      title={widget?.title}
      width={'min(92vw, 640px)'}
      onClose={onClose}
    >
      {widget && (
        <Flexbox data-widget-detail={widget.id} gap={16}>
          {widget.description && <Text type={'secondary'}>{widget.description}</Text>}
          <WidgetSummary widget={widget} />
          <Tabs
            activeKey={tab}
            items={[
              { key: 'data', label: t('detail.tab.data') },
              { key: 'runs', label: t('detail.tab.runs') },
              { key: 'versions', label: t('detail.tab.versions') },
            ]}
            onChange={(key) => setTab(key as DetailTab)}
          />
          {tab === 'data' && <WidgetData widget={widget} />}
          {tab === 'runs' && <RunHistory widgetId={widget.id} />}
          {tab === 'versions' && <VersionList widgetId={widget.id} />}
        </Flexbox>
      )}
    </Drawer>
  );
});

WidgetDetailDrawer.displayName = 'DashboardWidgetDetailDrawer';

export default WidgetDetailDrawer;
