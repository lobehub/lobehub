'use client';

import { Button } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { lambdaClient } from '@/libs/trpc/client';

import { createOAuthAppModal } from './CreateAppModal';
import { showClientSecretModal } from './SecretModal';

const CreateAppButton = () => {
  const { t } = useTranslation('auth');
  const { allowed: hasEditPermission, reason } = usePermission('create_content');
  const activeWorkspaceId = useActiveWorkspaceId();
  // Workspace OAuth apps are shared admin config — Admin-or-higher, matching
  // the server's `requireWorkspaceRoleWhenScoped('admin')` gate.
  const { allowed: canManageWorkspaceApps } = usePermission('manage_settings');
  const canEdit = hasEditPermission && (!activeWorkspaceId || canManageWorkspaceApps);
  const navigate = useWorkspaceAwareNavigate();

  const handleCreate = () => {
    if (!canEdit) return;
    createOAuthAppModal({
      onSubmit: async (values) => {
        // The secret is generated on demand on the app page, not at creation.
        const created = await lambdaClient.oauthApp.create.mutate({
          ...values,
          issueSecret: false,
        });
        navigate(`/settings/oauth-apps/${created.id}`);

        // An older server ignores `issueSecret` and still mints a web app's
        // secret, returning its only plaintext copy here. Reveal it rather than
        // drop it, or the app could only ever be rotated.
        if (created.clientSecret) showClientSecretModal({ clientSecret: created.clientSecret });
      },
    });
  };

  return (
    <Button disabled={!canEdit} title={reason} type={'primary'} onClick={handleCreate}>
      {t('oauthApp.list.actions.create')}
    </Button>
  );
};

export default CreateAppButton;
