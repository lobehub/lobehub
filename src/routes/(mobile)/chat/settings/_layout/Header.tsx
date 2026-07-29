'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

const Header = memo(() => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();

  return (
    <ChatHeader
      showBackButton
      center={<ChatHeader.Title title={t('header.session')} />}
      style={mobileHeaderSticky}
      onBackClick={() => navigate(-1)}
    />
  );
});

export default Header;
