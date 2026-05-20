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

// Explicit tab → i18n key map. Covers:
// - Cross-namespace entries (subscription / auth).
// - Kebab-case SettingsTabs (e.g. 'service-model') whose URL slug doesn't match the camelCase locale key.
//   Without an explicit entry, `setting:tab.${tab}` would resolve to a missing key and render the raw string.
// - Profile: prefer shorter "Profile" (`auth:profile.title`) over "My Account" (`auth:tab.profile`) on mobile.
const TAB_TITLE_KEY: Partial<Record<SettingsTabs, string>> = {
  [SettingsTabs.Billing]: 'subscription:tab.billing',
  [SettingsTabs.Credits]: 'subscription:tab.credits',
  [SettingsTabs.Plans]: 'subscription:tab.plans',
  [SettingsTabs.Profile]: 'auth:profile.title',
  [SettingsTabs.Referral]: 'subscription:tab.referral',
  [SettingsTabs.ServiceModel]: 'setting:tab.serviceModel',
  [SettingsTabs.Stats]: 'auth:tab.stats',
  [SettingsTabs.SystemTools]: 'setting:tab.systemTools',
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
  const tabTitleKey = tab ? (TAB_TITLE_KEY[tab] ?? `setting:tab.${tab}`) : 'setting:tab.all';
  // i18next's strict key union rejects dynamic strings. `Parameters<typeof t>[0]` would push TS
  // onto the wrong overload and infer the return as `unknown`, so we fall back to `as any`.
  // Unknown keys surface visibly as raw text, which is acceptable.
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
