import type { DeviceGitLinkedPullRequest } from '@lobechat/types';
import { Button, Center, Empty, Flexbox, Icon, ScrollArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { GlobeIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import {
  useFetchGitAheadBehind,
  useFetchGitPullRequestActivity,
  useFetchGitPullRequestDetail,
  useFetchGitPullRequestMergeContext,
} from '@/store/device';
import { sidebarRow } from '@/styles/density.stylex';
import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import { sectionProps } from '../Overview/sectionStyles';
import { resolvePullRequestActionLock } from './actionLock';
import Header from './Header';
import MergeDock from './MergeDock';
import { checkoutPublishesTo } from './mergeDockData';
import Sections from './Sections';
import PullRequestSkeleton from './Skeleton';
import { usePullRequestActions } from './usePullRequestActions';

const styles = stylex.create({
  root: { flex: '1', minHeight: '0' },
  scroll: { overflow: 'hidden', flex: '1', minHeight: '0' },
  scrollContent: {
    paddingBlockStart: '8px',
    paddingBlockEnd: sidebarRow.paneBlockEnd,
    paddingInline: sidebarRow.paneInline,
  },
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
  repositoryPath?: string;
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
    repositoryPath,
    summary,
    url,
    workingDirectory,
  }) => {
    const { t } = useTranslation('chat');
    const readPath = repositoryPath ?? workingDirectory;
    const {
      data,
      error: fetchError,
      isConfirmed: detailConfirmed,
      isLoading,
      mutate,
    } = useFetchGitPullRequestDetail(deviceId, readPath, number, { active });
    // A number is only unique within a repository. Do not act on another
    // repository's PR if the source checkout resolves a different remote.
    const matches = !url || data?.detail?.url.toLowerCase() === url.toLowerCase();
    const coreDetail = matches ? data?.detail : undefined;
    const activity = useFetchGitPullRequestActivity(
      deviceId,
      readPath,
      coreDetail?.number,
      active && coreDetail?.state === 'open',
    );
    const {
      data: cachedContext,
      error: contextError,
      isConfirmed: contextConfirmed,
      mutate: mutateContext,
    } = useFetchGitPullRequestMergeContext(deviceId, readPath, coreDetail ?? undefined);
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
      detailConfirmed: detailConfirmed && matches,
      detailError: fetchError,
    });
    const actions = usePullRequestActions({
      deviceId,
      locked: actionsLocked,
      policyLocked,
      mutateDetail: mutate,
      number,
      repositoryPath: readPath,
      url: coreDetail?.url,
      workingDirectory,
    });

    const detail = useMemo(() => {
      const core = coreDetail ? { ...coreDetail, ...activity.data } : undefined;
      if (!core || !context) return core ?? undefined;
      const required = new Set(context.requiredChecks);
      return {
        ...core,
        baseBehindBy: context.baseBehindBy,
        checks: core.checks.map((check) => ({ ...check, required: required.has(check.name) })),
        viewerCanBypass: context.viewerCanBypass,
        viewerCanWrite: context.viewerCanWrite,
      };
    }, [coreDetail, context, activity.data]);
    const externalUrl = detail?.url ?? url;
    const loadError = (error: unknown, onRetry: () => void) => (
      <Flexbox {...sectionProps()}>
        <AsyncError
          align={'start'}
          details={error instanceof Error ? error.message : undefined}
          error={error}
          title={t('workingPanel.pr.error.load')}
          variant={'inline'}
          onRetry={onRetry}
        />
      </Flexbox>
    );

    if (isLoading && !data) return <PullRequestSkeleton summary={summary} />;

    if (data?.status === 'gh-missing')
      return (
        <Center paddingBlock={24}>
          <Empty
            description={t('workingPanel.pr.ghMissing.desc')}
            icon={TriangleAlertIcon}
            iconColor={cssVar.colorWarning}
            title={t('workingPanel.pr.ghMissing.title')}
            action={
              <Flexbox horizontal gap={6}>
                <Button type={'primary'} onClick={() => void mutate()}>
                  {t('workingPanel.pr.ghMissing.retry')}
                </Button>
                {externalUrl && (
                  <Button
                    icon={<Icon icon={GlobeIcon} size={12} />}
                    onClick={() => openTrustedExternalUrl(externalUrl)}
                  >
                    {t('workingPanel.pr.ghMissing.open')}
                  </Button>
                )}
              </Flexbox>
            }
          />
        </Center>
      );

    if (!detail) return loadError(fetchError, () => void mutate());

    // The checkout's unpushed commits belong to this PR only when the checkout
    // publishes to its head; otherwise "Push N commits" would publish another
    // branch under this PR (one topic can link several PRs).
    const local =
      aheadBehind?.hasUpstream && checkoutPublishesTo(aheadBehind, detail.headRefName)
        ? { ahead: aheadBehind.ahead }
        : undefined;

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
