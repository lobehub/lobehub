'use client';

import { Flexbox, Highlighter, Skeleton, Text  } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { RUNTIME_LANGUAGE } from '../WidgetDetail/diffContent';
import { AccessFacts, Fact, reviewStyles, ReviewUnavailable } from './ReviewFacts';
import { useWidgetReview } from './useWidgetReview';

interface DryRunReviewProps {
  /** Holds the host's approve action until the version that will run is on screen. */
  onApprovalBlockedChange?: (blocked: boolean) => void;
  /**
   * Called once with the version shown when the request named none, so the
   * caller can persist it into the request: approval then runs exactly the
   * version reviewed here.
   */
  onPinVersion?: (versionId: string) => void;
  /** The version that will run; when absent the current draft is shown and pinned. */
  versionId?: string;
  widgetId: string;
}

/**
 * Approval for running an agent-written draft that reads credentials or
 * reaches the network: the exact script, its runtime, and what it may touch.
 */
const DryRunReview = memo<DryRunReviewProps>(
  ({ widgetId, versionId, onApprovalBlockedChange, onPinVersion }) => {
    const { t } = useTranslation('dashboard');
    const { error, retry, status, target, widget } = useWidgetReview(widgetId, versionId, {
      onApprovalBlockedChange,
      onPinVersion,
    });

    if (status === 'error' || status === 'missing') {
      return <ReviewUnavailable error={error} missing={status === 'missing'} onRetry={retry} />;
    }

    if (!widget || !target) {
      return (
        <Flexbox gap={10}>
          <Skeleton.Text rows={3} />
          <Skeleton height={120} width={'100%'} />
        </Flexbox>
      );
    }

    return (
      <Flexbox data-widget-dry-run-review={widgetId} gap={12}>
        <Flexbox gap={4}>
          <Text weight={600}>{`${widget.title} · v${target.version}`}</Text>
          <Text fontSize={12} type={'secondary'}>
            {t('dryRun.intro')}
          </Text>
        </Flexbox>

        <Flexbox className={reviewStyles.section} gap={6}>
          <Fact label={t('dryRun.runtime')}>
            <Text fontSize={12}>{target.runtime}</Text>
          </Fact>
          <AccessFacts manifest={target.manifest} />
        </Flexbox>

        <Flexbox gap={6}>
          <Text fontSize={12} type={'secondary'} weight={500}>
            {t('publish.scriptNew')}
          </Text>
          <Highlighter
            language={RUNTIME_LANGUAGE[target.runtime] ?? 'plaintext'}
            style={{ maxHeight: 360, overflow: 'auto' }}
            variant={'filled'}
          >
            {target.script}
          </Highlighter>
        </Flexbox>
      </Flexbox>
    );
  },
);

DryRunReview.displayName = 'DashboardDryRunReview';

export default DryRunReview;
