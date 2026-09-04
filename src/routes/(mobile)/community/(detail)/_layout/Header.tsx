'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { routerSelectors, useRouterStore } from '@/store/router';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

const Header = memo(() => {
  const pathname = useRouterStore(routerSelectors.pathname);
  const navigate = useWorkspaceAwareNavigate();

  // Extract the path segment (assistant, model, provider, mcp)
  const path = pathname.split('/').find(Boolean);

  return (
    <ChatHeader
      showBackButton
      style={mobileHeaderSticky}
      onBackClick={() => navigate(`/${path}`)}
    />
  );
});

export default Header;
