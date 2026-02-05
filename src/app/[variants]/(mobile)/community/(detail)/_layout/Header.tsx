'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { mobileHeaderSticky } from '@/styles/mobileHeader';

const Header = memo(() => {
  const location = useLocation();
  const navigate = useNavigate();

  // Extract the path segment (assistant, model, provider, mcp)
  const path = location.pathname.split('/').find(Boolean);

  return (
    <ChatHeader
      showBackButton
      style={mobileHeaderSticky}
      onBackClick={() => navigate(`/${path}`)}
    />
  );
});

export default Header;
