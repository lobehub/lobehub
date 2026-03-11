'use client';

import { Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { useShowMobileWorkspace } from '@/hooks/useShowMobileWorkspace';
import { type SettingsTabs } from '@/store/global/initialState';
import { useSessionStore } from '@/store/session';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

const Header = memo(() => {
  const { t } = useTranslation('setting');
  const showMobileWorkspace = useShowMobileWorkspace();
  const navigate = useNavigate();
  const params = useParams<{ providerId?: string; tab?: string }>();

  const isSessionActive = useSessionStore((s) => !!s.activeId);
  const isProvider = params.providerId && params.providerId !== 'all';

  const handleBackClick = () => {
    if (isSessionActive && showMobileWorkspace) {
      navigate('/agent');
    } else if (isProvider) {
      navigate('/settings/provider/all');
    } else {
      navigate('/me/settings');
    }
  };

  return (
    <ChatHeader
      showBackButton
      style={mobileHeaderSticky}
      center={
        <ChatHeader.Title
          title={
            <Flexbox horizontal align={'center'} gap={8}>
              <span style={{ lineHeight: 1.2 }}>
                {isProvider
                  ? params.providerId
                  : t(`tab.${(params.tab || 'all') as SettingsTabs}` as any)}
              </span>
            </Flexbox>
          }
        />
      }
      onBackClick={handleBackClick}
    />
  );
});

export default Header;
