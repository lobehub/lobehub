'use client';

import { Block, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { Button, Tabs } from '@lobehub/ui/base-ui';
import { Empty } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Plus, UserRoundIcon, UsersIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';
import { createCreateCredModal } from '@/routes/(main)/settings/creds/features/CreateCredModal';
import CredsList from '@/routes/(main)/settings/creds/features/CredsList';
import {
  type CredsApi,
  CredsApiProvider,
} from '@/routes/(main)/settings/creds/features/useCredsApi';

import PersonalCredsSection from './features/PersonalCredsSection';

// Always the personal namespace — the personal scope is deliberately
// personal-scoped regardless of page context (see PersonalCredsSection).
const personalCredsApi: CredsApi = {
  client: lambdaClient.market.creds,
  query: lambdaQuery.market.creds,
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    width: 100%;
    padding-block: 4px;
    padding-inline: 16px;
  `,
  desc: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

type CredsScope = 'personal' | 'workspace';

/**
 * Workspace credential management.
 *
 * One unified header row — scope tabs on the left, the create action on the
 * right — above an outlined list container (same container treatment as the
 * agent channel detail page). The create button follows the active scope.
 *
 * - "Workspace" tab: the shared {@link CredsList} rebound to the cloud
 *   `workspaceCreds.*` tRPC namespace via {@link CredsApiProvider}.
 *   `workspaceCreds` resolves the active workspace to its Market organization
 *   mirror; Market's `list` there already merges the org's own credentials
 *   with every member's *published* (public-visibility) personal credentials,
 *   so a shared credential surfaces here automatically once its owner turns
 *   on the share toggle in the personal tab.
 * - "Personal" tab: {@link PersonalCredsSection} — the caller's own personal
 *   credentials, each with a switch to share/unshare it into this workspace's
 *   organization (and a private/public visibility choice once shared). Always
 *   personal-scoped, independent of the workspace org's setup state.
 *
 * When the workspace has no Market organization yet (Community Profile not
 * completed), the backend returns NOT_FOUND for the *workspace* scope. This
 * component intercepts that error and renders a setup prompt in its place —
 * the personal tab still works, since sharing your own credential doesn't
 * require the org to exist yet (it will simply fail with a normal error until
 * Community Profile setup completes).
 */
const WorkspaceCredsSetting = () => {
  const { t } = useTranslation('setting');
  const { isAuthenticated } = useMarketAuth();
  const { allowed: canManageCredentials, reason } = usePermission('manage_provider_key');
  const [scope, setScope] = useState<CredsScope>('workspace');

  const workspaceCredsApi = useMemo<CredsApi>(
    () => ({
      // The workspaceCreds router is a structural mirror of market.creds, but
      // strict typeof equality breaks because workspaceCreds is registered in
      // the cloud lambda namespace. Cast at the boundary; downstream consumers
      // only touch overlapping members (list/get/createKV/createOAuth/
      // createFile/update/delete/uploadFile/listOAuthConnections).
      client: lambdaClient.workspaceCreds as unknown as CredsApi['client'],
      query: lambdaQuery.workspaceCreds as unknown as CredsApi['query'],
    }),
    [],
  );

  // Pre-flight check: detect "org not set up" before rendering the list.
  // React Query deduplicates this against the identical call inside CredsList,
  // so only one network request is made — which is also why `refetch` here
  // refreshes the workspace list too: creating a credential from the header,
  // or sharing/unsharing/re-visibility-ing a credential from the personal tab,
  // changes what this org-scoped list should return, but those mutations live
  // in other components with no direct handle on CredsList's own query. Since
  // both hooks share the same query key (workspaceCreds.list, input
  // undefined), refetching this one pushes the fresh result to every
  // subscriber, including CredsList's.
  const {
    error,
    isLoading,
    refetch: refetchWorkspaceCreds,
  } = workspaceCredsApi.query.list.useQuery(undefined, {
    enabled: isAuthenticated,
    // No retry for NOT_FOUND — the org won't materialise on its own.
    // Cap retries for other errors (500s, network) so failures surface instead of looping.
    retry: (failureCount, err) => {
      const code = (err as { data?: { code?: string } })?.data?.code;
      if (code === 'NOT_FOUND') return false;
      return failureCount < 3;
    },
  });

  // Same dedup trick for the personal scope: shares its query key with the
  // list inside PersonalCredsSection, so a create from the unified header
  // refreshes that tab's list (and pre-warms it while the workspace tab is
  // active, since the tabs render only the active scope).
  const { refetch: refetchPersonalCreds } = personalCredsApi.query.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const orgMissing = isAuthenticated && !isLoading && error?.data?.code === 'NOT_FOUND';

  // The owner-only `manage_provider_key` gate mirrors the server's
  // `requireWorkspaceRole('owner')` on workspaceCreds writes — but it only
  // applies to the workspace scope. Personal credentials are the caller's own
  // (`market.creds`), so workspace RBAC never disables creation there.
  const canCreate = scope === 'workspace' ? canManageCredentials : true;
  const createBlockedReason = scope === 'workspace' && !canManageCredentials ? reason : '';

  const handleCreate = () => {
    if (!canCreate) return;
    if (scope === 'workspace') {
      createCreateCredModal({
        credsApi: workspaceCredsApi,
        onSuccess: () => refetchWorkspaceCreds(),
      });
    } else {
      createCreateCredModal({
        credsApi: personalCredsApi,
        onSuccess: () => refetchPersonalCreds(),
      });
    }
  };

  // Hidden while signed out (the list shows the sign-in prompt instead) and
  // while the workspace org is missing (creation would fail server-side).
  const showCreateButton = isAuthenticated && !(scope === 'workspace' && orgMissing);

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
          activeKey={scope}
          items={[
            {
              icon: <Icon icon={UsersIcon} />,
              key: 'workspace',
              label: t('creds.tabs.workspace'),
            },
            {
              icon: <Icon icon={UserRoundIcon} />,
              key: 'personal',
              label: t('creds.tabs.personal'),
            },
          ]}
          onChange={(key) => setScope(key as CredsScope)}
        />
        {showCreateButton &&
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
        <Text className={styles.desc}>
          {scope === 'workspace'
            ? t('creds.workspaceSection.desc')
            : t('creds.personalSection.desc')}
        </Text>
        <Block className={styles.container} variant={'outlined'}>
          {scope === 'workspace' ? (
            orgMissing ? (
              <Flexbox align={'center'} justify={'center'} style={{ padding: 48 }}>
                <Empty description={t('creds.orgSetupRequired')} />
              </Flexbox>
            ) : (
              <CredsApiProvider value={workspaceCredsApi}>
                <CredsList />
              </CredsApiProvider>
            )
          ) : (
            <PersonalCredsSection onWorkspaceCredsChange={refetchWorkspaceCreds} />
          )}
        </Block>
      </Flexbox>
    </Flexbox>
  );
};

WorkspaceCredsSetting.displayName = 'WorkspaceCredsSetting';

export default WorkspaceCredsSetting;
