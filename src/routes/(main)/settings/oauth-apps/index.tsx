import { Skeleton } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useIsWorkspaceOwner } from '@/business/client/hooks/useIsWorkspaceOwner';
import NotFound from '@/components/404';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { lambdaClient } from '@/libs/trpc/client';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';

import { createOAuthAppModal } from './features/CreateAppModal';
import OAuthApps from './features/OAuthApps';

const CreateAppButton = () => {
  const { t } = useTranslation('auth');
  const { allowed: hasEditPermission, reason } = usePermission('create_content');
  const activeWorkspaceId = useActiveWorkspaceId();
  const isWorkspaceOwner = useIsWorkspaceOwner();
  const canEdit = hasEditPermission && (!activeWorkspaceId || isWorkspaceOwner);
  const navigate = useWorkspaceAwareNavigate();

  const handleCreate = () => {
    if (!canEdit) return;
    createOAuthAppModal({
      onSubmit: async (values) => {
        const created = await lambdaClient.oauthApp.create.mutate(values);
        navigate(`/settings/oauth-apps/${created.id}`);
      },
    });
  };

  return (
    <Button disabled={!canEdit} title={reason} type={'primary'} onClick={handleCreate}>
      {t('oauthApp.list.actions.create')}
    </Button>
  );
};

const Page = () => {
  const { t } = useTranslation('auth');
  const { allowed: hasEditPermission } = usePermission('create_content');
  const activeWorkspaceId = useActiveWorkspaceId();
  const isWorkspaceOwner = useIsWorkspaceOwner();
  const params = useParams<{ sub?: string }>();
  const canEdit = hasEditPermission && (!activeWorkspaceId || isWorkspaceOwner);
  const [isPreferenceInit, enableOAuthApps] = useUserStore((s) => [
    preferenceSelectors.isPreferenceInit(s),
    labPreferSelectors.enableOAuthApps(s),
  ]);

  if (!isPreferenceInit) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;
  if (!enableOAuthApps) return <NotFound />;

  return (
    <>
      <SettingHeader
        extra={!params.sub && canEdit && <CreateAppButton />}
        title={t('tab.oauthApps')}
      />
      <OAuthApps canEdit={canEdit} />
    </>
  );
};

export default Page;
