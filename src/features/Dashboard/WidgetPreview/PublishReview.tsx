'use client';

import { Alert, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSchedule } from '../utils/schedule';
import { ScriptDiff } from '../WidgetDetail/VersionDiff';
import { resolvePublishSchedule } from './previewWidget';
import {
  AccessFacts,
  Fact,
  FoldedSection,
  ReviewPreviewCard,
  ReviewSection,
  reviewStyles,
  ReviewUnavailable,
} from './ReviewFacts';
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
 * Everything a user needs to approve making a widget live: the card its dry
 * run produced, what it means, what it may touch (network, credentials), how
 * often it runs, and — folded — exactly how its code differs from what is
 * live now.
 */
const PublishReview = memo<PublishReviewProps>(
  ({ widgetId, versionId, summary, onApprovalBlockedChange, onPinVersion }) => {
    const { t } = useTranslation('dashboard');
    const { error, retry, run, status, target, versions, widget } = useWidgetReview(
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

    const manifest = target.manifest;
    // The cadence publishing will actually retain, not the manifest's raw
    // suggestion: an already-scheduled widget keeps its own schedule.
    const schedule = resolvePublishSchedule(widget, manifest);

    return (
      <Flexbox data-widget-publish-review={widgetId} gap={12}>
        <Flexbox gap={4}>
          <Text weight={600}>{`${widget.title} · v${target.version}`}</Text>
          {summary && <Text fontSize={13}>{summary}</Text>}
        </Flexbox>

        {run ? (
          <ReviewSection title={t('review.expected')}>
            <ReviewPreviewCard run={run} view={target.view} widget={widget} />
          </ReviewSection>
        ) : (
          <Alert showIcon title={t('publish.noSuccessfulRun')} type={'warning'} />
        )}

        {/* The intro introduces the credentials and schedule it sits above. */}
        <Text fontSize={12} type={'secondary'}>
          {t('publish.intro')}
        </Text>

        <Flexbox className={reviewStyles.section} gap={6}>
          <Fact label={t('chat.definition')}>
            <Text fontSize={12}>{widget.description || t('chat.noDefinition')}</Text>
          </Fact>
          <Fact label={t('publish.schedule')}>
            <Text fontSize={12}>
              {schedule.pattern
                ? formatSchedule(t, schedule.pattern, schedule.timezone)
                : t('publish.scheduleNone')}
            </Text>
          </Fact>
          <AccessFacts manifest={manifest} />
        </Flexbox>

        <FoldedSection
          title={
            live && live.id !== target.id
              ? t('publish.scriptChanges', { version: live.version })
              : t('publish.scriptNew')
          }
        >
          <ScriptDiff base={live && live.id !== target.id ? live : undefined} target={target} />
        </FoldedSection>
      </Flexbox>
    );
  },
);

PublishReview.displayName = 'DashboardPublishReview';

export default PublishReview;
