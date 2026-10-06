'use client';

import { Flexbox, Highlighter } from '@lobehub/ui';
import { Skeleton, Text } from '@lobehub/ui/base-ui';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import { RUNTIME_LANGUAGE } from '../WidgetDetail/diffContent';
import { AccessFacts, Fact, reviewStyles } from './ReviewFacts';

interface DryRunReviewProps {
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
const DryRunReview = memo<DryRunReviewProps>(({ widgetId, versionId, onPinVersion }) => {
  const { t } = useTranslation('dashboard');
  const useFetchWidgetDetail = useDashboardStore((s) => s.useFetchWidgetDetail);
  const useFetchWidgetVersions = useDashboardStore((s) => s.useFetchWidgetVersions);
  useFetchWidgetDetail(widgetId);
  useFetchWidgetVersions(widgetId);
  const widget = useDashboardStore(dashboardSelectors.widgetDetail(widgetId));
  const versions = useDashboardStore(dashboardSelectors.widgetVersions(widgetId));

  const targetId = versionId ?? widget?.draftVersionId ?? undefined;
  const target = versions.find((version) => version.id === targetId);

  const unpinnedTargetId = versionId ? undefined : target?.id;
  useEffect(() => {
    if (unpinnedTargetId) onPinVersion?.(unpinnedTargetId);
  }, [unpinnedTargetId, onPinVersion]);

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
});

DryRunReview.displayName = 'DashboardDryRunReview';

export default DryRunReview;
