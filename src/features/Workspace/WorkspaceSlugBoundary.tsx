'use client';

import { Button, Center } from '@lobehub/ui';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate } from 'react-router';

import { useWorkspaceFromSlug } from './useWorkspaceFromSlug';

/**
 * Layout boundary for the `/:workspaceSlug` subtree.
 *
 * - Calls `useWorkspaceFromSlug` to resolve the slug → status.
 * - Renders a 404-style empty state when the slug doesn't match any workspace.
 * - Renders a billing-inactive state page when the workspace's subscription
 *   has lapsed and the caller is not the primary owner (no silent demote to
 *   personal mode — strict workspace/personal isolation).
 * - Renders `<Outlet />` when the workspace is found (or still loading).
 */
const WorkspaceSlugBoundary: FC = () => {
  const { t } = useTranslation('error');
  const navigate = useNavigate();
  const result = useWorkspaceFromSlug();

  // Workspaces are still being fetched — render nothing so the parent layout
  // spinner shows through instead of flashing a false 404.
  if (result.status === 'loading') return null;

  if (result.status === 'not-found') {
    return (
      <Center gap={16} height={'100%'} style={{ flexDirection: 'column' }} width={'100%'}>
        <div style={{ fontSize: 48 }}>🔍</div>
        <div style={{ fontWeight: 600, fontSize: 20 }}>{t('notFound.title')}</div>
        <div style={{ opacity: 0.6 }}>{t('notFound.check')}</div>
        <Button onClick={() => navigate('/')}>{t('notFound.backHome')}</Button>
      </Center>
    );
  }

  if (result.status === 'locked-out') {
    return (
      <Center gap={16} height={'100%'} style={{ flexDirection: 'column' }} width={'100%'}>
        <div style={{ fontSize: 48 }}>🔒</div>
        <div style={{ fontWeight: 600, fontSize: 20 }}>{t('workspaceBillingInactive.title')}</div>
        <div style={{ maxWidth: 480, opacity: 0.6, textAlign: 'center' }}>
          {t('workspaceBillingInactive.description')}
        </div>
        <Button onClick={() => navigate('/')}>{t('workspaceBillingInactive.backHome')}</Button>
      </Center>
    );
  }

  return <Outlet />;
};

export default WorkspaceSlugBoundary;
