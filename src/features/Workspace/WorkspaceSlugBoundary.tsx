'use client';

import { Button, Center, Flexbox, Text } from '@lobehub/ui';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { mutate } from 'swr';

import { WORKSPACE_LIST_KEY } from '@/business/client/hooks/useWorkspaces';
import { setActiveWorkspaceSnapshot } from '@/business/client/hooks/workspaceState';
import { lambdaClient } from '@/libs/trpc/client';

import { useWorkspaceFromSlug } from './useWorkspaceFromSlug';

/**
 * Layout boundary for the `/:workspaceSlug` subtree.
 *
 * - Calls `useWorkspaceFromSlug` to resolve the slug → status.
 * - Renders a 404-style empty state when the slug doesn't match any workspace.
 * - Renders `<Outlet />` when the workspace is found (or still loading).
 */
const WorkspaceSlugBoundary: FC = () => {
  const { t } = useTranslation('error');
  const { search } = useLocation();
  const navigate = useNavigate();
  const result = useWorkspaceFromSlug();
  const [accepting, setAccepting] = useState(false);
  const inviteToken = new URLSearchParams(search).get('invite');

  // Workspaces are still being fetched — render nothing so the parent layout
  // spinner shows through instead of flashing a false 404.
  if (result.status === 'loading') return null;

  if (result.status === 'not-found') {
    const acceptInvite = async () => {
      setAccepting(true);
      try {
        const accepted = inviteToken
          ? await lambdaClient.workspaceMember.acceptInvitation.mutate({ token: inviteToken })
          : (
              await lambdaClient.workspaceMember.acceptInvitationByWorkspaceSlug.mutate({
                slug: result.slug,
              })
            ).member;

        const acceptedWorkspace = (
          accepted as typeof accepted & { workspace?: { slug?: string } | null }
        ).workspace;
        const acceptedSlug = acceptedWorkspace?.slug ?? result.slug;

        setActiveWorkspaceSnapshot({ id: accepted.workspaceId, slug: acceptedSlug });
        await mutate(WORKSPACE_LIST_KEY);
        navigate(`/${acceptedSlug}`, { replace: true });
      } finally {
        setAccepting(false);
      }
    };

    return (
      <Center gap={16} height={'100%'} style={{ flexDirection: 'column' }} width={'100%'}>
        <Flexbox align="center" gap={8} style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48 }}>🔍</div>
          <Text as="div" style={{ fontWeight: 600, fontSize: 20 }}>
            Workspace «{result.slug}» пока недоступен
          </Text>
          <Text as="div" type="secondary">
            Если вас пригласили в эту команду, примите приглашение. Иначе проверьте адрес.
          </Text>
        </Flexbox>
        <Flexbox horizontal gap={8}>
          <Button loading={accepting} type="primary" onClick={acceptInvite}>
            Принять приглашение
          </Button>
          <Button onClick={() => navigate('/')}>{t('notFound.backHome')}</Button>
        </Flexbox>
      </Center>
    );
  }

  return <Outlet />;
};

export default WorkspaceSlugBoundary;
