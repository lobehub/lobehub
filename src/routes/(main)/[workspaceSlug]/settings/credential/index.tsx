'use client';

import { Block, Button, Empty, Flexbox, Icon, Tabs, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Lock, Plus, UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsWorkspaceViewer } from '@/business/client/hooks/useIsWorkspaceViewer';
import { createCreateCredModal } from '@/features/Settings/creds/features/CreateCredModal';
import MarketSignInGate from '@/features/Settings/creds/features/MarketSignInGate';
import { type CredsApi } from '@/features/Settings/creds/features/useCredsApi';
import WorkspaceCredsList from '@/features/Settings/creds/features/WorkspaceCredsList';
import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';

const styles = stylex.create({
  container: { overflow: 'hidden', width: '100%', paddingBlock: '4px', paddingInline: '16px' },
  desc: { fontSize: '13px', color: cssVar.colorTextSecondary },
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

const workspaceCredsApi = (createVisibility: Visibility): CredsApi => ({
  client: workspaceClient,
  createVisibility,
  query: lambdaQuery.workspaceCreds as unknown as CredsApi['query'],
  setVisibility: (id, visibility) => workspaceClient.setVisibility.mutate({ id, visibility }),
});

const credsApiByTab: Record<Visibility, CredsApi> = {
  private: workspaceCredsApi('private'),
  public: workspaceCredsApi('public'),
};

/**
 * Workspace credential management, split like the device page:
 *
 * - "Workspace": credentials every member can use — the workspace's own and
 *   members' personal credentials published here.
 * - "Private": credentials only the caller can use in this workspace — ones
 *   they created here, and their personal credentials shared here privately.
 *
 * A credential created on a tab belongs to the workspace with that tab's
 * visibility; personal credentials are shared in from the personal settings
 * page ("Share to Workspace…"), not listed here wholesale.
 *
 * When the workspace has no Market organization yet (Community Profile not
 * completed), the backend returns NOT_FOUND and the page shows a setup prompt.
 */
const WorkspaceCredsSetting = () => {
  const { t } = useTranslation('setting');
  const { isAuthenticated } = useMarketAuth();
  const { allowed: isAdmin, reason } = usePermission('manage_provider_key');
  const isViewer = useIsWorkspaceViewer();
  const [tab, setTab] = useState<Visibility>('public');
  const credsApi = credsApiByTab[tab];

  // Both tabs filter this one list; it also shares its query key with the
  // list inside WorkspaceCredsList, so `refetch` here refreshes the tab.
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

  // Shared credentials need the Admin-or-higher `manage_provider_key`, matching
  // the server; private ones are any non-viewer member's own.
  const canCreate = tab === 'public' ? isAdmin : !isViewer;
  const createBlockedReason =
    tab === 'public' ? (isAdmin ? '' : reason) : isViewer ? t('creds.viewerHint') : '';

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
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <Tabs
          activeKey={tab}
          items={[
            { icon: <Icon icon={UsersIcon} />, key: 'public', label: t('creds.tabs.workspace') },
            { icon: <Icon icon={Lock} />, key: 'private', label: t('creds.tabs.private') },
          ]}
          onChange={(key) => setTab(key as Visibility)}
        />
        {isAuthenticated &&
          !orgMissing &&
          // Disabled buttons swallow hover events, so the tooltip needs the
          // span wrapper to fire (see the usePermission docstring pattern).
          (createBlockedReason ? (
            <Tooltip title={createBlockedReason}>
              <span>{createButton}</span>
            </Tooltip>
          ) : (
            createButton
          ))}
      </Flexbox>
      <Flexbox gap={12}>
        <Text className={stylex.props(styles.desc).className}>
          {t(tab === 'public' ? 'creds.workspaceSection.desc' : 'creds.privateSection.desc')}
        </Text>
        <Block className={stylex.props(styles.container).className} variant={'outlined'}>
          <MarketSignInGate>
            {orgMissing ? (
              <Flexbox align={'center'} justify={'center'} style={{ padding: 48 }}>
                <Empty description={t('creds.orgSetupRequired')} />
              </Flexbox>
            ) : (
              <WorkspaceCredsList credsApi={credsApi} key={tab} visibility={tab} />
            )}
          </MarketSignInGate>
        </Block>
      </Flexbox>
    </Flexbox>
  );
};

WorkspaceCredsSetting.displayName = 'WorkspaceCredsSetting';

export default WorkspaceCredsSetting;
