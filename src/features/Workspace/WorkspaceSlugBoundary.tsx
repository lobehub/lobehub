'use client';

import { Center } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate } from 'react-router';

import { useWorkspaceFromSlug } from './useWorkspaceFromSlug';

/**
 * Layout boundary for the `/:workspaceSlug` subtree.
 *
 * - Calls `useWorkspaceFromSlug` to resolve the slug → status.
 * - Renders a 404-style empty state when the slug doesn't match any workspace.
 * - Renders `<Outlet />` when the workspace is found (or still loading).
 *
 * A billing-inactive workspace is intentionally NOT blocked here — the member
 * should still be able to browse shared content. The "subscription inactive"
 * banner lives in the UserPanel and the chat-level error card surfaces when a
 * spend operation is attempted.
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

  return <Outlet />;
};

export default WorkspaceSlugBoundary;
