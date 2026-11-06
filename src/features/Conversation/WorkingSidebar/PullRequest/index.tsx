import type { DeviceGitLinkedPullRequest } from '@lobechat/types';
import { Button, Empty, Flexbox, Icon, ScrollArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { GlobeIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';
import {
  useFetchGitAheadBehind,
  useFetchGitPullRequestActivity,
  useFetchGitPullRequestDetail,
  useFetchGitPullRequestMergeContext,
} from '@/store/device';

import { OverviewRow } from '../Overview/OverviewRow';
import { sectionProps } from '../Overview/sectionStyles';
import { resolvePullRequestActionLock } from './actionLock';
import Header from './Header';
import MergeDock from './MergeDock';
import Sections from './Sections';
import PullRequestSkeleton from './Skeleton';
import { usePullRequestActions } from './usePullRequestActions';

const styles = stylex.create({
  root: { flex: '1', minHeight: '0' },
  scroll: { overflow: 'hidden', flex: '1', minHeight: '0' },
  scrollContent: { paddingBlockStart: '0', paddingBlockEnd: '10px' },
  viewport: { overflowX: 'hidden' },
});

interface PullRequestProps {
  active: boolean;
  /**
   * This session's branch and linked-PR reads confirmed `number`. Until then
   * the pane may paint persisted rows, but must not mutate the PR.
   */
  confirmed: boolean;
  /** The failed branch / linked-PR read keeping `confirmed` false. */
  confirmError?: unknown;
  deviceId?: string;
  number: number;
  onOpenTab: (tab: string) => void;
  /** Re-run the branch / linked-PR reads that confirm `number`. */
  onRetryConfirm?: () => void;
  summary?: DeviceGitLinkedPullRequest;
  url?: string;
  workingDirectory: string;
}

const PullRequest = memo<PullRequestProps>(
  ({
    active,
    confirmError,
    confirmed,
    deviceId,
    number,
    onOpenTab,
    onRetryConfirm,
    summary,
    url,
    workingDirectory,
  }) => {
    const { t } = useTranslation('chat');
    const { t: tCommon } = useTranslation('common');
    const {
      data,
      error: fetchError,
      isConfirmed: detailConfirmed,
      isLoading,
      mutate,
    } = useFetchGitPullRequestDetail(deviceId, workingDirectory, number, { active });
    const activity = useFetchGitPullRequestActivity(
      deviceId,
      workingDirectory,
      data?.detail?.number,
      active && data?.detail?.state === 'open',
    );
    const {
      data: cachedContext,
      error: contextError,
      isConfirmed: contextConfirmed,
      mutate: mutateContext,
    } = useFetchGitPullRequestMergeContext(deviceId, workingDirectory, data?.detail ?? undefined);
    const { data: aheadBehind } = useFetchGitAheadBehind(deviceId, workingDirectory);
    // Stale content stays paintable; actions wait for the live reads.
    const {
      context,
      contextLoading,
      locked: actionsLocked,
      policyLocked,
      refreshFailed,
    } = resolvePullRequestActionLock({
      confirmError,
      confirmed,
      context: cachedContext,
      contextConfirmed,
      contextError,
      detailConfirmed,
      detailError: fetchError,
    });
    const actions = usePullRequestActions({
      deviceId,
      locked: actionsLocked,
      policyLocked,
      mutateDetail: mutate,
      number,
      workingDirectory,
    });

    const detail = useMemo(() => {
      const core = data?.detail ? { ...data.detail, ...activity.data } : undefined;
      if (!core || !context) return core ?? undefined;
      const required = new Set(context.requiredChecks);
      return {
        ...core,
        baseBehindBy: context.baseBehindBy,
        checks: core.checks.map((check) => ({ ...check, required: required.has(check.name) })),
        viewerCanBypass: context.viewerCanBypass,
        viewerCanWrite: context.viewerCanWrite,
      };
    }, [data?.detail, context, activity.data]);
    const externalUrl = detail?.url ?? url;
    const loadError = (error: unknown, onRetry: () => void) => (
      <Flexbox {...sectionProps()}>
        <OverviewRow
          danger
          icon={TriangleAlertIcon}
          iconColor={cssVar.colorError}
          title={error instanceof Error ? error.message : undefined}
          value={t('workingPanel.pr.error.load')}
          trailing={
            <Button icon={<Icon icon={RefreshCwIcon} size={12} />} size={'small'} onClick={onRetry}>
              {tCommon('retry')}
            </Button>
          }
        />
      </Flexbox>
    );

    if (isLoading && !data) return <PullRequestSkeleton summary={summary} />;

    if (data?.status === 'gh-missing')
      return (
        <Empty
          description={t('workingPanel.pr.ghMissing.desc')}
          icon={TriangleAlertIcon}
          iconColor={cssVar.colorWarning}
          title={t('workingPanel.pr.ghMissing.title')}
          action={
            <Flexbox horizontal gap={6}>
              <Button size={'small'} type={'primary'} onClick={() => void mutate()}>
                {t('workingPanel.pr.ghMissing.retry')}
              </Button>
              {externalUrl && (
                <Button
                  icon={<Icon icon={GlobeIcon} size={12} />}
                  size={'small'}
                  onClick={() => void electronSystemService.openExternalLink(externalUrl)}
                >
                  {t('workingPanel.pr.ghMissing.open')}
                </Button>
              )}
            </Flexbox>
          }
        />
      );

    if (!detail) return loadError(fetchError, () => void mutate());

    const local = aheadBehind?.hasUpstream ? { ahead: aheadBehind.ahead } : undefined;

    return (
      <Flexbox className={stylex.props(styles.root).className}>
        <ScrollArea
          disableContentFit
          scrollFade
          className={stylex.props(styles.scroll).className}
          contentProps={{ className: stylex.props(styles.scrollContent).className }}
          viewportProps={{
            className: stylex.props(styles.viewport).className,
            style: { overflowX: 'hidden' },
          }}
        >
          {/* The persisted PR still paints, but stays locked until a live read lands. */}
          {refreshFailed &&
            loadError(confirmError ?? fetchError ?? contextError, () => {
              onRetryConfirm?.();
              void mutate();
              void mutateContext();
            })}
          <Header
            actionsDisabled={actionsLocked || policyLocked}
            activityLoaded={!!activity.data}
            detail={detail}
            deviceId={deviceId}
            workingDirectory={workingDirectory}
            onAction={actions.run}
          />
          <Sections
            actionsDisabled={actionsLocked}
            activity={activity}
            busy={actions.busy}
            detail={detail}
            onAction={actions.run}
            onOpenTab={onOpenTab}
          />
        </ScrollArea>
        <MergeDock
          busy={actions.busy}
          contextLoading={contextLoading}
          detail={detail}
          error={actions.error}
          local={local}
          onAction={actions.run}
          onDismissError={actions.dismissError}
          onPush={actions.push}
          onRetry={actions.retry}
        />
      </Flexbox>
    );
  },
);

PullRequest.displayName = 'PullRequestPane';

export default PullRequest;
