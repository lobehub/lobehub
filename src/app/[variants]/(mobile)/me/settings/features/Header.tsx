'use client';

import { Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { mobileHeaderSticky } from '@/styles/mobileHeader';

const Header = memo(() => {
  const { t } = useTranslation('common');

  const navigate = useNavigate();
  return (
    <ChatHeader
      showBackButton
      style={mobileHeaderSticky}
      center={
        <ChatHeader.Title
          title={
            <Flexbox horizontal align={'center'} gap={4}>
              {t('userPanel.setting')}
            </Flexbox>
          }
        />
      }
      onBackClick={() => navigate('/me')}
    />
  );
});

export default Header;
