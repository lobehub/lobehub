'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Fragment, useEffect, useState } from 'react';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import { useSettingsAnchorScroll } from '@/features/SettingsSearch/anchor';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { SettingsTabs } from '@/store/global/initialState';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { ManageMemoryButton } from '../memory/features/ManageMemoryButton';
import { componentMap } from './componentMap';
import { getSettingsContainerMaxWidth, OWN_FRAME_TABS } from './ownFrameTabs';
import { SettingsHeaderActionsContext } from './SettingsHeaderActions';
import { useSettingsTabTitle } from './tabTitles';

const REDIRECT_MAP: Record<string, string> = {
  [SettingsTabs.Common]: SettingsTabs.Appearance,
  [SettingsTabs.ChatAppearance]: SettingsTabs.Appearance,
  [SettingsTabs.Agent]: SettingsTabs.ServiceModel,
  [SettingsTabs.TTS]: SettingsTabs.ServiceModel,
  [SettingsTabs.Image]: SettingsTabs.ServiceModel,
};

interface SettingsContentProps {
  activeTab?: string;
  mobile?: boolean;
}

const SettingsContent = ({ mobile, activeTab }: SettingsContentProps) => {
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const navigate = useWorkspaceAwareNavigate();
  const title = useSettingsTabTitle(activeTab);
  const [headerActions, setHeaderActions] = useState<HTMLElement | null>(null);

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

    // The shared navigation header (desktop) or the mobile layout header shows
    // the tab title, so no tab draws a second, in-page title.
    const componentProps: { mobile?: boolean; showSettingHeader?: boolean } = {
      showSettingHeader: false,
    };
    if (
      [
        SettingsTabs.About,
        SettingsTabs.Devices,
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
        if (activeTab !== tabKey) return null;
        const content = renderComponent(tabKey);
        if (OWN_FRAME_TABS.has(tabKey)) return <Fragment key={tabKey}>{content}</Fragment>;
        const headerExtra = tabKey === SettingsTabs.Memory ? <ManageMemoryButton /> : undefined;
        return (
          <Fragment key={tabKey}>
            <NavHeader
              styles={{ center: { alignItems: 'center' } }}
              right={
                <Flexbox horizontal align={'center'} gap={8}>
                  {headerExtra}
                  <div
                    ref={setHeaderActions}
                    style={{ alignItems: 'center', display: 'flex', gap: 8 }}
                  />
                </Flexbox>
              }
            >
              {title && <Text weight={500}>{title}</Text>}
            </NavHeader>
            <SettingsHeaderActionsContext value={headerActions}>
              <SettingContainer
                maxWidth={getSettingsContainerMaxWidth(tabKey)}
                paddingBlock={'24px 128px'}
                paddingInline={24}
              >
                {content}
              </SettingContainer>
            </SettingsHeaderActionsContext>
          </Fragment>
        );
      })}
    </>
  );
};

export default SettingsContent;
