'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Empty } from 'antd';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';
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

import CredsSection from './features/CredsSection';
import PersonalCredsSection from './features/PersonalCredsSection';

/**
 * Workspace credential management.
 *
 * Two sections, each grouped in an outlined container ({@link CredsSection}):
 * - Top ("workspace"): the shared {@link CredsList} rebound to the cloud
 *   `workspaceCreds.*` tRPC namespace via {@link CredsApiProvider}.
 *   `workspaceCreds` resolves the active workspace to its Market organization
 *   mirror; Market's `list` there already merges the org's own credentials
 *   with every member's *published* (public-visibility) personal credentials,
 *   so a shared credential surfaces here automatically once its owner turns
 *   on {@link PersonalCredsSection}'s share toggle. The section header carries
 *   the create action — the page header stays a plain title.
 * - Bottom ("your personal credentials"): {@link PersonalCredsSection} — the
 *   caller's own personal credentials, each with a switch to share/unshare it
 *   into this workspace's organization (and a private/public visibility
 *   choice once shared). Always personal-scoped, independent of the workspace
 *   org's setup state.
 *
 * When the workspace has no Market organization yet (Community Profile not
 * completed), the backend returns NOT_FOUND for the *workspace* section. This
 * component intercepts that error and renders a setup prompt in its place —
 * the personal section still renders below it, since sharing your own
 * credential doesn't require the org to exist yet (it will simply fail with
 * a normal error until Community Profile setup completes).
 */
const WorkspaceCredsSetting = () => {
  const { t } = useTranslation('setting');
  const { isAuthenticated } = useMarketAuth();
  const { allowed: canManageCredentials, reason } = usePermission('manage_provider_key');

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

  // Pre-flight check: detect "org not set up" before rendering the full list.
  // React Query deduplicates this against the identical call inside CredsList,
  // so only one network request is made — which is also why `refetch` here
  // refreshes the workspace section's list too: creating a credential from the
  // section header, or sharing/unsharing/re-visibility-ing a credential from
  // `PersonalCredsSection` below, changes what this org-scoped list should
  // return, but those mutations live in other components with no direct handle
  // on CredsList's own query. Since both hooks share the same query key
  // (workspaceCreds.list, input undefined), refetching this one pushes the
  // fresh result to every subscriber, including CredsList's.
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

  const orgMissing = isAuthenticated && !isLoading && error?.data?.code === 'NOT_FOUND';

  const handleCreate = () => {
    if (!canManageCredentials) return;
    createCreateCredModal({
      credsApi: workspaceCredsApi,
      onSuccess: () => refetchWorkspaceCreds(),
    });
  };

  // Hidden while the org is missing (creation would fail server-side) and
  // while signed out (CredsList shows the sign-in prompt instead).
  const showCreateButton = isAuthenticated && !orgMissing;

  return (
    <>
      <CredsSection
        desc={t('creds.workspaceSection.desc')}
        title={t('creds.workspaceSection.title')}
        extra={
          showCreateButton && (
            <Tooltip title={reason}>
              <Button
                disabled={!canManageCredentials}
                icon={<Icon icon={Plus} />}
                size={'small'}
                type={'primary'}
                onClick={handleCreate}
              >
                {t('creds.create')}
              </Button>
            </Tooltip>
          )
        }
      >
        {orgMissing ? (
          <Flexbox align={'center'} justify={'center'} style={{ padding: 48 }}>
            <Empty description={t('creds.orgSetupRequired')} />
          </Flexbox>
        ) : (
          <CredsApiProvider value={workspaceCredsApi}>
            <CredsList />
          </CredsApiProvider>
        )}
      </CredsSection>
      <PersonalCredsSection onWorkspaceCredsChange={refetchWorkspaceCreds} />
    </>
  );
};

WorkspaceCredsSetting.displayName = 'WorkspaceCredsSetting';

export default WorkspaceCredsSetting;
