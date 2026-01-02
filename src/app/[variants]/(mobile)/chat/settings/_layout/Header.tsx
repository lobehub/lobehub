'use client';

import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { mobileHeaderSticky } from '@/styles/mobileHeader';

const Header = memo(() => {
  const { t } = useTranslation('setting');
  const navigate = useNavigate();

  return (
    <ChatHeader
      center={<ChatHeader.Title title={t('header.session')} />}
      onBackClick={() => navigate(-1)}
      showBackButton
      style={mobileHeaderSticky}
    />
  );
});

export default Header;
