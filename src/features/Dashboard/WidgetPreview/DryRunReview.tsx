'use client';

import type { BuiltinRememberApproval } from '@lobechat/types';
import { Flexbox, Highlighter, Skeleton, Text, toast } from '@lobehub/ui';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardWidgetDetail, DashboardWidgetVersionItem } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { RUNTIME_LANGUAGE } from '../WidgetDetail/diffContent';
import { findExpectedRun, sampleOutputFor } from './previewWidget';
import {
  AccessFacts,
  Fact,
  FoldedSection,
  ReviewPreviewCard,
  ReviewSampleCard,
  ReviewSection,
  reviewStyles,
  ReviewUnavailable,
} from './ReviewFacts';
import ReviewStage from './ReviewStage';
import { useWidgetReview } from './useWidgetReview';

interface ExpectedPreviewProps {
  target: DashboardWidgetVersionItem;
  versions: DashboardWidgetVersionItem[];
  widget: DashboardWidgetDetail;
}

/**
 * The card the dry run is expected to produce, before it runs: this
 * version's last usable result, else an earlier version's for reference,
 * else a sample-valued card of the same shape. Informational only — it never
 * holds approval, which is about access.
 */
const ExpectedPreview = ({ target, versions, widget }: ExpectedPreviewProps) => {
  const { t } = useTranslation('dashboard');
  const useFetchWidgetRuns = useDashboardStore((s) => s.useFetchWidgetRuns);
  const { data, isLoading } = useFetchWidgetRuns(widget.id);
  const runs = useDashboardStore(dashboardSelectors.widgetRuns(widget.id));

  const title = t('review.expected');
  if (!data && isLoading) {
    return (
      <ReviewSection title={title}>
        <Skeleton height={150} width={'100%'} />
      </ReviewSection>
    );
  }

  const expected = findExpectedRun(runs, target);
  if (!expected) {
    const sample = sampleOutputFor(target.outputType, target.view, {
      item: (index) => t('review.sampleItem', { index }),
      name: t('review.sampleName'),
      series: t('review.sampleTag'),
      value: t('review.sampleValue'),
    });
    return (
      <ReviewSection note={t('review.expectedSample')} title={title}>
        <ReviewSampleCard output={sample} view={target.view} widget={widget} />
      </ReviewSection>
    );
  }

  const source = versions.find((version) => version.id === expected.run.versionId);
  return (
    <ReviewSection
      title={title}
      note={
        expected.sameVersion
          ? t('review.expectedSameVersion')
          : t('review.expectedEarlier', { version: source?.version ?? '?' })
      }
    >
      <ReviewPreviewCard run={expected.run} view={target.view} widget={widget} />
    </ReviewSection>
  );
};

interface DryRunReviewProps {
  /** Holds the host's approve action until the version that will run is on screen. */
  onApprovalBlockedChange?: (blocked: boolean) => void;
  /**
   * Called once with the version shown when the request named none, so the
   * caller can persist it into the request: approval then runs exactly the
   * version reviewed here.
   */
  onPinVersion?: (versionId: string) => void;
  /** The host's hook to offer an "approve and stop asking for this access" choice. */
  registerRememberApproval?: (option: BuiltinRememberApproval) => () => void;
  /** The version that will run; when absent the current draft is shown and pinned. */
  versionId?: string;
  widgetId: string;
}

/**
 * Approval for running an agent-written draft that reads credentials or
 * reaches the network: the card it is expected to produce, what it measures
 * and may touch, and — folded — the exact script.
 */
const DryRunReview = memo<DryRunReviewProps>(
  ({ widgetId, versionId, onApprovalBlockedChange, onPinVersion, registerRememberApproval }) => {
    const { t } = useTranslation('dashboard');
    const { error, retry, status, target, versions, widget } = useWidgetReview(
      widgetId,
      versionId,
      {
        onApprovalBlockedChange,
        onPinVersion,
      },
    );
    const grantDryRunAccess = useDashboardStore((s) => s.grantDryRunAccess);
    const userId = useUserStore(userProfileSelectors.userId);
    // Only the widget's creator reviews its dry runs and may grant standing access.
    const canRemember = !!widget && !!userId && widget.userId === userId;
    const targetId = target?.id;

    // "Similar" for a dry run means the same connectors and hosts: picking the
    // shared "approve, and don't ask again for similar actions" choice records
    // a standing grant of this version's access — never a plain approve or a
    // rejection. A failed grant does not hold the approval itself.
    useEffect(() => {
      if (!canRemember || !targetId || !registerRememberApproval) return;
      return registerRememberApproval({
        onRemember: async () => {
          try {
            await grantDryRunAccess(widgetId, targetId);
          } catch (grantError) {
            console.error('[dashboard] dry-run grant failed', grantError);
            toast.error(t('dryRun.rememberFailed'));
          }
        },
      });
    }, [canRemember, grantDryRunAccess, registerRememberApproval, t, targetId, widgetId]);

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
        <ReviewStage stage={'dryRun'} title={widget.title} version={target.version}>
          <Text fontSize={12} type={'secondary'}>
            {t('dryRun.intro')}
          </Text>
        </ReviewStage>

        <ExpectedPreview target={target} versions={versions} widget={widget} />

        <Flexbox className={reviewStyles.section} gap={6}>
          <Fact label={t('chat.definition')}>
            <Text fontSize={12}>{widget.description || t('chat.noDefinition')}</Text>
          </Fact>
          <AccessFacts manifest={target.manifest} />
        </Flexbox>

        <FoldedSection title={`${t('publish.scriptNew')} · ${target.runtime}`}>
          <Highlighter
            language={RUNTIME_LANGUAGE[target.runtime] ?? 'plaintext'}
            style={{ maxHeight: 360, overflow: 'auto' }}
            variant={'filled'}
          >
            {target.script}
          </Highlighter>
        </FoldedSection>
      </Flexbox>
    );
  },
);

DryRunReview.displayName = 'DashboardDryRunReview';

export default DryRunReview;
