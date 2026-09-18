import { Empty, Flexbox, Icon } from '@lobehub/ui';
import { Button, ScrollArea } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { GlobeIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';
import {
  useFetchGitAheadBehind,
  useFetchGitPullRequestDetail,
  useFetchGitPullRequestMergeContext,
  useFetchGitWorkingTreeStatus,
} from '@/store/device';

import { OverviewRow } from '../Overview/OverviewRow';
import { sectionStyles } from '../Overview/sectionStyles';
import Header from './Header';
import MergeDock from './MergeDock';
import Sections from './Sections';
import PullRequestSkeleton from './Skeleton';
import { usePullRequestActions } from './usePullRequestActions';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    flex: 1;
    min-height: 0;
  `,
  scroll: css`
    overflow: hidden;
    flex: 1;
    min-height: 0;
  `,
  scrollContent: css`
    padding-block: 0 10px;
  `,
  viewport: css`
    overflow-x: hidden;
  `,
}));

interface PullRequestProps {
  active: boolean;
  deviceId?: string;
  number: number;
  onOpenTab: (tab: string) => void;
  url?: string;
  workingDirectory: string;
}

const PullRequest = memo<PullRequestProps>(
  ({ active, deviceId, number, onOpenTab, url, workingDirectory }) => {
    const { t } = useTranslation('chat');
    const { t: tCommon } = useTranslation('common');
    const {
      data,
      error: fetchError,
      isLoading,
      mutate,
    } = useFetchGitPullRequestDetail(deviceId, workingDirectory, number, { active });
    const { data: context } = useFetchGitPullRequestMergeContext(
      deviceId,
      workingDirectory,
      data?.detail ?? undefined,
    );
    const { data: aheadBehind } = useFetchGitAheadBehind(deviceId, workingDirectory);
    const { data: workingTree } = useFetchGitWorkingTreeStatus(deviceId, workingDirectory);
    const actions = usePullRequestActions({
      deviceId,
      mutateDetail: mutate,
      number,
      workingDirectory,
    });

    const detail = useMemo(() => {
      const core = data?.detail;
      if (!core || !context) return core ?? undefined;
      const required = new Set(context.requiredChecks);
      return {
        ...core,
        baseBehindBy: context.baseBehindBy,
        checks: core.checks.map((check) => ({ ...check, required: required.has(check.name) })),
        viewerCanBypass: context.viewerCanBypass,
        viewerCanWrite: context.viewerCanWrite,
      };
    }, [data?.detail, context]);
    const externalUrl = detail?.url ?? url;

    if (isLoading && !data) return <PullRequestSkeleton />;

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

    if (!detail)
      return (
        <Flexbox className={sectionStyles.section}>
          <OverviewRow
            danger
            icon={TriangleAlertIcon}
            iconColor={cssVar.colorError}
            title={fetchError instanceof Error ? fetchError.message : undefined}
            value={t('workingPanel.pr.error.load')}
            trailing={
              <Button
                icon={<Icon icon={RefreshCwIcon} size={12} />}
                size={'small'}
                onClick={() => void mutate()}
              >
                {tCommon('retry')}
              </Button>
            }
          />
        </Flexbox>
      );

    const local =
      aheadBehind?.hasUpstream || workingTree
        ? { ahead: aheadBehind?.ahead ?? 0, dirtyFiles: workingTree?.total ?? 0 }
        : undefined;

    return (
      <Flexbox className={styles.root}>
        <ScrollArea
          disableContentFit
          scrollFade
          className={styles.scroll}
          contentProps={{ className: styles.scrollContent }}
          viewportProps={{ className: styles.viewport, style: { overflowX: 'hidden' } }}
        >
          <Header
            detail={detail}
            deviceId={deviceId}
            workingDirectory={workingDirectory}
            onAction={actions.run}
          />
          <Sections
            busy={actions.busy}
            detail={detail}
            onAction={actions.run}
            onOpenTab={onOpenTab}
          />
        </ScrollArea>
        <MergeDock
          busy={actions.busy}
          contextLoading={context === undefined}
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
