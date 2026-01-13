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
      center={
        <ChatHeader.Title
          title={
            <Flexbox align={'center'} gap={4} horizontal>
              {t('userPanel.setting')}
            </Flexbox>
          }
        />
      }
      onBackClick={() => navigate('/me')}
      showBackButton
      style={mobileHeaderSticky}
    />
  );
});

export default Header;
