import { Button } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { lambdaClient } from '@/libs/trpc/client';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import { createOAuthAppModal } from './features/CreateAppModal';
import OAuthApps from './features/OAuthApps';

const CreateAppButton = () => {
  const { t } = useTranslation('auth');
  const { allowed: canEdit, reason } = usePermission('create_content');
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
  const params = useParams<{ sub?: string }>();

  return (
    <>
      <SettingHeader extra={!params.sub && <CreateAppButton />} title={t('tab.oauthApps')} />
      <OAuthApps />
    </>
  );
};

export default Page;
