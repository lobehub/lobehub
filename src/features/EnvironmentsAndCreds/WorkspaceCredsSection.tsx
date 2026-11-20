'use client';

import { Block, Button, Empty, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsWorkspaceViewer } from '@/business/client/hooks/useIsWorkspaceViewer';
import { type VisibilityFilterValue } from '@/components/VisibilityFilter';
import { createCreateCredModal } from '@/features/Settings/creds/features/CreateCredModal';
import MarketSignInGate from '@/features/Settings/creds/features/MarketSignInGate';
import { type CredsApi } from '@/features/Settings/creds/features/useCredsApi';
import WorkspaceCredsList from '@/features/Settings/creds/features/WorkspaceCredsList';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';
import { densityTokens } from '@/styles/density.stylex';

import { CREDENTIALS_SECTION_ID } from './const';
import SectionTitle from './SectionTitle';
import { useScrollToSection } from './useScrollToSection';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    width: '100%',
    paddingBlock: '4px',
    paddingInline: densityTokens['--lobe-density-card-padding'],
  },
});

type Visibility = 'private' | 'public';

interface WorkspaceCredsClient {
  setVisibility: {
    mutate: (input: { id: number; visibility: Visibility }) => Promise<unknown>;
  };
}

/**
 * The cloud `workspaceCreds` router mirrors `market.creds` (plus
 * `setVisibility`), but it is registered in the cloud lambda namespace — the
 * open-source build only has an empty stub — so strict typeof equality
 * breaks. Cast at the boundary; consumers only touch overlapping members.
 */
const workspaceClient = lambdaClient.workspaceCreds as unknown as CredsApi['client'] &
  WorkspaceCredsClient;

/**
 * A new credential starts private: any non-viewer member may create one, and
 * nothing is shared until its row's "Publish to Workspace" says so.
 */
const credsApi: CredsApi = {
  client: workspaceClient,
  createVisibility: 'private',
  query: lambdaQuery.workspaceCreds as unknown as CredsApi['query'],
  setVisibility: (id, visibility) => workspaceClient.setVisibility.mutate({ id, visibility }),
};

interface WorkspaceCredsSectionProps {
  /** The page's one header filter, shared with the environments section. */
  visibilityFilter: VisibilityFilterValue;
}

/**
 * The credentials section of the workspace Environments & Credentials page:
 * every credential the caller can use here — the shared ones (the
 * workspace's own and members' personal credentials published here) and the
 * caller's private ones, marked with a lock. Personal credentials are shared
 * in from the personal settings page ("Share to Workspace…").
 *
 * When the workspace has no Market organization yet (Community Profile not
 * completed), the backend returns NOT_FOUND and the section shows a setup
 * prompt.
 */
const WorkspaceCredsSection = memo<WorkspaceCredsSectionProps>(({ visibilityFilter }) => {
  const { t } = useTranslation('setting');
  const { isAuthenticated } = useMarketAuth();
  const isViewer = useIsWorkspaceViewer();
  const ref = useScrollToSection<HTMLDivElement>(CREDENTIALS_SECTION_ID);

  // Shares its query key with the list inside WorkspaceCredsList, so
  // `refetch` here refreshes the list.
  const { error, isLoading, refetch } = credsApi.query.list.useQuery(undefined, {
    enabled: isAuthenticated,
    // No retry for NOT_FOUND — the org won't materialise on its own.
    // Cap retries for other errors (500s, network) so failures surface instead of looping.
    retry: (failureCount, err) => {
      const code = (err as { data?: { code?: string } })?.data?.code;
      if (code === 'NOT_FOUND') return false;
      return failureCount < 3;
    },
  });

  const orgMissing = isAuthenticated && !isLoading && error?.data?.code === 'NOT_FOUND';

  // New credentials are private, which any non-viewer member may create.
  const canCreate = !isViewer;

  const handleCreate = () => {
    if (!canCreate) return;
    createCreateCredModal({ credsApi, onSuccess: () => refetch() });
  };

  const createButton = (
    <Button
      disabled={!canCreate}
      icon={<Icon icon={Plus} />}
      type={'primary'}
      onClick={handleCreate}
    >
      {t('creds.create')}
    </Button>
  );

  return (
    <Flexbox gap={16} id={CREDENTIALS_SECTION_ID} ref={ref}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <SectionTitle title={t('environmentsAndCreds.section.creds')} />
        {isAuthenticated && !orgMissing && (
          <Flexbox style={{ flex: 'none' }}>
            {
              // Disabled buttons swallow hover events, so the tooltip needs the
              // span wrapper to fire (see the usePermission docstring pattern).
              isViewer ? (
                <Tooltip title={t('creds.viewerHint')}>
                  <span>{createButton}</span>
                </Tooltip>
              ) : (
                createButton
              )
            }
          </Flexbox>
        )}
      </Flexbox>
      <Block className={stylex.props(styles.container).className} variant={'outlined'}>
        <MarketSignInGate>
          {orgMissing ? (
            <Flexbox align={'center'} justify={'center'} style={{ padding: 48 }}>
              <Empty description={t('creds.orgSetupRequired')} />
            </Flexbox>
          ) : (
            <WorkspaceCredsList credsApi={credsApi} visibilityFilter={visibilityFilter} />
          )}
        </MarketSignInGate>
      </Block>
    </Flexbox>
  );
});

WorkspaceCredsSection.displayName = 'WorkspaceCredsSection';

export default WorkspaceCredsSection;
