'use client';

import { Text } from '@lobehub/ui';
import { Fragment, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import { useSettingsAnchorScroll } from '@/features/SettingsSearch/anchor';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { SettingsTabs } from '@/store/global/initialState';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { ManageMemoryButton } from '../memory/features/ManageMemoryButton';
import { componentMap } from './componentMap';

const REDIRECT_MAP: Record<string, string> = {
  [SettingsTabs.Common]: SettingsTabs.Appearance,
  [SettingsTabs.ChatAppearance]: SettingsTabs.Appearance,
  [SettingsTabs.Agent]: SettingsTabs.ServiceModel,
  [SettingsTabs.TTS]: SettingsTabs.ServiceModel,
  [SettingsTabs.Image]: SettingsTabs.ServiceModel,
};

const COMPACT_HEADER_TABS = [
  SettingsTabs.About,
  SettingsTabs.APIKey,
  SettingsTabs.Appearance,
  SettingsTabs.Billing,
  SettingsTabs.Credits,
  SettingsTabs.Devices,
  SettingsTabs.Hotkey,
  SettingsTabs.Memory,
  SettingsTabs.Notification,
  SettingsTabs.Plans,
  SettingsTabs.Profile,
  SettingsTabs.Referral,
  SettingsTabs.ServiceModel,
  SettingsTabs.Stats,
  SettingsTabs.Storage,
] as const;

interface SettingsContentProps {
  activeTab?: string;
  mobile?: boolean;
}

const SettingsContent = ({ mobile, activeTab }: SettingsContentProps) => {
  const { t } = useTranslation(['auth', 'setting', 'subscription']);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const navigate = useWorkspaceAwareNavigate();

  const compactHeaderTitles: Partial<Record<SettingsTabs, string>> = {
    [SettingsTabs.About]: t('setting:tab.about'),
    [SettingsTabs.APIKey]: t('setting:tab.apikey'),
    [SettingsTabs.Appearance]: t('setting:tab.appearance'),
    [SettingsTabs.Billing]: t('subscription:tab.billing'),
    [SettingsTabs.Credits]: t('subscription:tab.credits'),
    [SettingsTabs.Devices]: t('setting:devices.title'),
    [SettingsTabs.Hotkey]: t('setting:tab.hotkey'),
    [SettingsTabs.Memory]: t('setting:tab.memory'),
    [SettingsTabs.Notification]: t('setting:tab.notification'),
    [SettingsTabs.Plans]: t('subscription:tab.plans'),
    [SettingsTabs.Profile]: t('auth:profile.title'),
    [SettingsTabs.Referral]: t('subscription:tab.referral'),
    [SettingsTabs.ServiceModel]: t('setting:tab.serviceModel'),
    [SettingsTabs.Stats]: t('auth:tab.stats'),
    [SettingsTabs.Storage]: t('setting:tab.storage'),
  };

  useSettingsAnchorScroll();

  useEffect(() => {
    if (activeTab && REDIRECT_MAP[activeTab]) {
      // Personal-only redirect: legacy URL aliases (common, agent, tts, image,
      // chat-appearance) map to personal-settings tabs. `escape: true` keeps the
      // user in personal context even when a workspace happens to be active.
      navigate(`/settings/${REDIRECT_MAP[activeTab]}`, { escape: true, replace: true });
    }
  }, [activeTab, navigate]);

  const renderComponent = (tab: string) => {
    const Component = componentMap[tab as keyof typeof componentMap] || componentMap.appearance;
    if (!Component) return null;

    const componentProps: { mobile?: boolean; showSettingHeader?: boolean } = {};
    if (COMPACT_HEADER_TABS.includes(tab as (typeof COMPACT_HEADER_TABS)[number])) {
      componentProps.showSettingHeader = false;
    }
    if (
      [
        SettingsTabs.About,
        SettingsTabs.ServiceModel,
        SettingsTabs.Provider,
        SettingsTabs.Profile,
        SettingsTabs.Stats,
        SettingsTabs.Usage,
        SettingsTabs.Creds,
        SettingsTabs.Security,
        ...(enableBusinessFeatures
          ? [SettingsTabs.Plans, SettingsTabs.Credits, SettingsTabs.Billing, SettingsTabs.Referral]
          : []),
      ].includes(tab as any)
    ) {
      componentProps.mobile = mobile;
    }

    return <Component {...componentProps} />;
  };

  if (activeTab && REDIRECT_MAP[activeTab]) return null;

  if (mobile) {
    return activeTab ? renderComponent(activeTab) : renderComponent(SettingsTabs.Profile);
  }

  return (
    <>
      {Object.keys(componentMap).map((tabKey) => {
        const isFullWidth =
          tabKey === SettingsTabs.Provider ||
          tabKey === SettingsTabs.Skill ||
          tabKey === SettingsTabs.Connector ||
          tabKey === SettingsTabs.Creds ||
          tabKey === SettingsTabs.Usage;
        if (activeTab !== tabKey) return null;
        const content = renderComponent(tabKey);
        if (isFullWidth) return <Fragment key={tabKey}>{content}</Fragment>;
        const compactHeaderTitle = compactHeaderTitles[tabKey as SettingsTabs];
        const compactHeaderExtra =
          tabKey === SettingsTabs.Memory ? <ManageMemoryButton /> : undefined;
        return (
          <Fragment key={tabKey}>
            <NavHeader
              right={compactHeaderExtra}
              styles={compactHeaderTitle ? { center: { alignItems: 'center' } } : undefined}
            >
              {compactHeaderTitle && <Text weight={500}>{compactHeaderTitle}</Text>}
            </NavHeader>
            <SettingContainer maxWidth={1024} paddingBlock={'24px 128px'} paddingInline={24}>
              {content}
            </SettingContainer>
          </Fragment>
        );
      })}
    </>
  );
};

export default SettingsContent;
