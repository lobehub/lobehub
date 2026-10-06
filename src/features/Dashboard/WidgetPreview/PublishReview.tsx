'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Skeleton, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import WidgetCard from '../WidgetCard';
import { ScriptDiff } from '../WidgetDetail/VersionDiff';
import { findSucceededPreviewRun, toPreviewWidget } from './previewWidget';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    flex: none;
    width: 88px;
    color: ${cssVar.colorTextTertiary};
  `,
  section: css`
    padding: 10px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

const Fact = ({ label, children }: { children: ReactNode; label: string }) => (
  <Flexbox horizontal align={'baseline'} gap={8}>
    <Text className={styles.label} fontSize={12}>
      {label}
    </Text>
    <Flexbox horizontal flex={1} gap={4} style={{ minWidth: 0 }} wrap={'wrap'}>
      {children}
    </Flexbox>
  </Flexbox>
);

interface PublishReviewProps {
  /**
   * Called once with the version shown when the request named none, so the
   * caller can persist it into the request: approval then publishes exactly
   * the version reviewed here, never whatever the draft is by then.
   */
  onPinVersion?: (versionId: string) => void;
  /** The agent's one-line reason, if it gave one. */
  summary?: string;
  /** The version under review; when absent the current draft is shown and pinned. */
  versionId?: string;
  widgetId: string;
}

/**
 * Everything a user needs to approve making a widget live: what it showed in
 * its dry run, what it means, what it may touch (network, credentials), how
 * often it runs, and exactly how its code differs from what is live now.
 */
const PublishReview = memo<PublishReviewProps>(({ widgetId, versionId, summary, onPinVersion }) => {
  const { t } = useTranslation('dashboard');
  const useFetchWidgetDetail = useDashboardStore((s) => s.useFetchWidgetDetail);
  const useFetchWidgetRuns = useDashboardStore((s) => s.useFetchWidgetRuns);
  const useFetchWidgetVersions = useDashboardStore((s) => s.useFetchWidgetVersions);
  useFetchWidgetDetail(widgetId);
  useFetchWidgetRuns(widgetId);
  useFetchWidgetVersions(widgetId);
  const widget = useDashboardStore(dashboardSelectors.widgetDetail(widgetId));
  const runs = useDashboardStore(dashboardSelectors.widgetRuns(widgetId));
  const versions = useDashboardStore(dashboardSelectors.widgetVersions(widgetId));

  const targetId = versionId ?? widget?.draftVersionId ?? undefined;
  const target = versions.find((version) => version.id === targetId);
  const live = versions.find((version) => version.status === 'published');

  const unpinnedTargetId = versionId ? undefined : target?.id;
  useEffect(() => {
    if (unpinnedTargetId) onPinVersion?.(unpinnedTargetId);
  }, [unpinnedTargetId, onPinVersion]);

  if (!widget || !target) {
    return (
      <Flexbox gap={10}>
        <Skeleton height={140} width={'100%'} />
        <Skeleton.Text rows={3} />
      </Flexbox>
    );
  }

  const run = findSucceededPreviewRun(runs, target.id);
  const manifest = target.manifest;
  const schedule = manifest?.schedule?.pattern ?? widget.schedulePattern;
  const hosts = manifest?.network?.allow ?? [];
  const env = manifest?.env ?? [];

  return (
    <Flexbox data-widget-publish-review={widgetId} gap={12}>
      <Flexbox gap={4}>
        <Text weight={600}>{`${widget.title} · v${target.version}`}</Text>
        {summary && <Text fontSize={13}>{summary}</Text>}
        <Text fontSize={12} type={'secondary'}>
          {t('publish.intro')}
        </Text>
      </Flexbox>

      {run ? (
        <Flexbox gap={6}>
          <Text fontSize={12} type={'secondary'} weight={500}>
            {t('publish.previewTitle')}
          </Text>
          <div style={{ height: run.output?.type === 'stat' ? 150 : 240 }}>
            <WidgetCard view={target.view} widget={toPreviewWidget(widget, run)} />
          </div>
        </Flexbox>
      ) : (
        <Alert showIcon title={t('publish.noSuccessfulRun')} type={'warning'} />
      )}

      <Flexbox className={styles.section} gap={6}>
        <Fact label={t('chat.definition')}>
          <Text fontSize={12}>{widget.description || t('chat.noDefinition')}</Text>
        </Fact>
        <Fact label={t('publish.schedule')}>
          <Text fontSize={12}>
            {schedule
              ? [schedule, manifest?.schedule?.timezone ?? widget.scheduleTimezone]
                  .filter(Boolean)
                  .join(' · ')
              : t('publish.scheduleNone')}
          </Text>
        </Fact>
        <Fact label={t('publish.network')}>
          {hosts.length > 0 ? (
            hosts.map((host) => (
              <Tag key={host} size={'small'}>
                {host}
              </Tag>
            ))
          ) : (
            <Text fontSize={12}>{t('publish.networkNone')}</Text>
          )}
        </Fact>
        <Fact label={t('publish.env')}>
          {env.length > 0 ? (
            env.map((item) => (
              <Tag key={item.name} size={'small'}>
                {item.connector ? `${item.name} ← ${item.connector}` : item.name}
              </Tag>
            ))
          ) : (
            <Text fontSize={12}>{t('publish.envNone')}</Text>
          )}
        </Fact>
      </Flexbox>

      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {live && live.id !== target.id
            ? t('publish.scriptChanges', { version: live.version })
            : t('publish.scriptNew')}
        </Text>
        <ScriptDiff base={live && live.id !== target.id ? live : undefined} target={target} />
      </Flexbox>
    </Flexbox>
  );
});

PublishReview.displayName = 'DashboardPublishReview';

export default PublishReview;
