'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

const Header = memo(() => {
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();

  // Extract the path segment (assistant, model, provider, mcp)
  const path = location.pathname.split('/').find(Boolean);

  const catalog = location.state?.marketplaceCatalog;

  return (
    <ChatHeader
      showBackButton
      style={mobileHeaderSticky}
      onBackClick={() =>
        typeof catalog === 'string'
          ? navigate(catalog, { escape: true, replace: true })
          : navigate(`/${path}`)
      }
    />
  );
});

export default Header;
