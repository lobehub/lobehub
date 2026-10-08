'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Skeleton, Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WidgetCard from '../WidgetCard';
import { ScriptDiff } from '../WidgetDetail/VersionDiff';
import { findSucceededPreviewRun, resolvePublishSchedule, toPreviewWidget } from './previewWidget';
import { AccessFacts, Fact, reviewStyles, ReviewUnavailable } from './ReviewFacts';
import { useWidgetReview } from './useWidgetReview';

interface PublishReviewProps {
  /** Holds the host's approve action until the version that goes live is on screen. */
  onApprovalBlockedChange?: (blocked: boolean) => void;
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
const PublishReview = memo<PublishReviewProps>(
  ({ widgetId, versionId, summary, onApprovalBlockedChange, onPinVersion }) => {
    const { t } = useTranslation('dashboard');
    const { error, retry, runs, status, target, versions, widget } = useWidgetReview(
      widgetId,
      versionId,
      { onApprovalBlockedChange, onPinVersion, withRuns: true },
    );
    const live = versions.find((version) => version.status === 'published');

    if (status === 'error' || status === 'missing') {
      return <ReviewUnavailable error={error} missing={status === 'missing'} onRetry={retry} />;
    }

    // Runs are part of the review too: never show "no successful run" before they load.
    if (!widget || !target || status === 'loading') {
      return (
        <Flexbox gap={10}>
          <Skeleton height={140} width={'100%'} />
          <Skeleton.Text rows={3} />
        </Flexbox>
      );
    }

    const run = findSucceededPreviewRun(runs, target.id);
    const manifest = target.manifest;
    // The cadence publishing will actually retain, not the manifest's raw
    // suggestion: an already-scheduled widget keeps its own schedule.
    const schedule = resolvePublishSchedule(widget, manifest);

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

        <Flexbox className={reviewStyles.section} gap={6}>
          <Fact label={t('chat.definition')}>
            <Text fontSize={12}>{widget.description || t('chat.noDefinition')}</Text>
          </Fact>
          <Fact label={t('publish.schedule')}>
            <Text fontSize={12}>
              {schedule.pattern
                ? [schedule.pattern, schedule.timezone].filter(Boolean).join(' · ')
                : t('publish.scheduleNone')}
            </Text>
          </Fact>
          <AccessFacts manifest={manifest} />
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
  },
);

PublishReview.displayName = 'DashboardPublishReview';

export default PublishReview;
