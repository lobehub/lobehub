'use client';

import { Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { useShowMobileWorkspace } from '@/hooks/useShowMobileWorkspace';
import { SettingsTabs } from '@/store/global/initialState';
import { useSessionStore } from '@/store/session';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

type TabNamespace = 'setting' | 'subscription' | 'auth';

// Tabs whose title key lives outside the default `setting` namespace.
const TAB_NAMESPACE: Partial<Record<SettingsTabs, TabNamespace>> = {
  [SettingsTabs.Billing]: 'subscription',
  [SettingsTabs.Credits]: 'subscription',
  [SettingsTabs.Plans]: 'subscription',
  [SettingsTabs.Referral]: 'subscription',
  [SettingsTabs.Stats]: 'auth',
};

// Prefer shorter "Profile" (`auth:profile.title`) over "My Account" (`auth:tab.profile`) on mobile.
const TAB_TITLE_KEY: Partial<Record<SettingsTabs, string>> = {
  [SettingsTabs.Profile]: 'auth:profile.title',
};

const Header = memo(() => {
  const { t } = useTranslation(['setting', 'auth', 'subscription']);
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

  const tab = params.tab as SettingsTabs | undefined;
  const tabTitleKey = tab
    ? (TAB_TITLE_KEY[tab] ?? `${TAB_NAMESPACE[tab] ?? 'setting'}:tab.${tab}`)
    : 'setting:tab.all';
  const tabTitle = t(tabTitleKey as any);

  return (
    <ChatHeader
      showBackButton
      style={mobileHeaderSticky}
      center={
        <ChatHeader.Title
          title={
            <Flexbox horizontal align={'center'} gap={8}>
              <span style={{ lineHeight: 1.2 }}>{isProvider ? params.providerId : tabTitle}</span>
            </Flexbox>
          }
        />
      }
      onBackClick={handleBackClick}
    />
  );
});

export default Header;
