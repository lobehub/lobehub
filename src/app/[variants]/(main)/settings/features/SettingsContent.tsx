'use client';

import { Fragment } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import dynamic from '@/libs/next/dynamic';
import { SettingsTabs } from '@/store/global/initialState';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

const componentMap = {
  [SettingsTabs.Common]: dynamic(() => import('../common'), {
    loading: () => <Loading debugId="Settings > Common" />,
  }),
  [SettingsTabs.ChatAppearance]: dynamic(() => import('../chat-appearance'), {
    loading: () => <Loading debugId="Settings > ChatAppearance" />,
  }),
  [SettingsTabs.Provider]: dynamic(() => import('../provider'), {
    loading: () => <Loading debugId="Settings > Provider" />,
  }),
  [SettingsTabs.Image]: dynamic(() => import('../image'), {
    loading: () => <Loading debugId="Settings > Image" />,
  }),
  [SettingsTabs.Memory]: dynamic(() => import('../memory'), {
    loading: () => <Loading debugId="Settings > Memory" />,
  }),
  [SettingsTabs.TTS]: dynamic(() => import('../tts'), {
    loading: () => <Loading debugId="Settings > TTS" />,
  }),
  [SettingsTabs.About]: dynamic(() => import('../about'), {
    loading: () => <Loading debugId="Settings > About" />,
  }),
  [SettingsTabs.Hotkey]: dynamic(() => import('../hotkey'), {
    loading: () => <Loading debugId="Settings > Hotkey" />,
  }),
  [SettingsTabs.Proxy]: dynamic(() => import('../proxy'), {
    loading: () => <Loading debugId="Settings > Proxy" />,
  }),
  [SettingsTabs.SystemTools]: dynamic(() => import('../system-tools'), {
    loading: () => <Loading debugId="Settings > SystemTools" />,
  }),
  [SettingsTabs.Storage]: dynamic(() => import('../storage'), {
    loading: () => <Loading debugId="Settings > Storage" />,
  }),
  [SettingsTabs.Agent]: dynamic(() => import('../agent'), {
    loading: () => <Loading debugId="Settings > Agent" />,
  }),
  // Profile related tabs
  [SettingsTabs.Profile]: dynamic(() => import('../profile'), {
    loading: () => <Loading debugId="Settings > Profile" />,
  }),
  [SettingsTabs.Stats]: dynamic(() => import('../stats'), {
    loading: () => <Loading debugId="Settings > Stats" />,
  }),
  [SettingsTabs.APIKey]: dynamic(() => import('../apikey'), {
    loading: () => <Loading debugId="Settings > APIKey" />,
  }),
  [SettingsTabs.Security]: dynamic(() => import('../security'), {
    loading: () => <Loading debugId="Settings > Security" />,
  }),
  [SettingsTabs.Skill]: dynamic(() => import('../skill'), {
    loading: () => <Loading debugId="Settings > Skill" />,
  }),

  [SettingsTabs.Plans]: dynamic(() => import('@/business/client/BusinessSettingPages/Plans'), {
    loading: () => <Loading debugId="Settings > Plans" />,
  }),
  [SettingsTabs.Funds]: dynamic(() => import('@/business/client/BusinessSettingPages/Funds'), {
    loading: () => <Loading debugId="Settings > Funds" />,
  }),
  [SettingsTabs.Usage]: dynamic(() => import('@/business/client/BusinessSettingPages/Usage'), {
    loading: () => <Loading debugId="Settings > Usage" />,
  }),
  [SettingsTabs.Billing]: dynamic(() => import('@/business/client/BusinessSettingPages/Billing'), {
    loading: () => <Loading debugId="Settings > Billing" />,
  }),
  [SettingsTabs.Referral]: dynamic(
    () => import('@/business/client/BusinessSettingPages/Referral'),
    {
      loading: () => <Loading debugId="Settings > Referral" />,
    },
  ),
};

interface SettingsContentProps {
  activeTab?: string;
  mobile?: boolean;
}

const SettingsContent = ({ mobile, activeTab }: SettingsContentProps) => {
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  const renderComponent = (tab: string) => {
    const Component = componentMap[tab as keyof typeof componentMap] || componentMap.common;
    if (!Component) return null;

    const componentProps: { mobile?: boolean } = {};
    if (
      [
        SettingsTabs.About,
        SettingsTabs.Agent,
        SettingsTabs.Provider,
        SettingsTabs.Profile,
        SettingsTabs.Stats,
        SettingsTabs.Security,
        ...(enableBusinessFeatures
          ? [
              SettingsTabs.Plans,
              SettingsTabs.Funds,
              SettingsTabs.Usage,
              SettingsTabs.Billing,
              SettingsTabs.Referral,
            ]
          : []),
      ].includes(tab as any)
    ) {
      componentProps.mobile = mobile;
    }

    return <Component {...componentProps} />;
  };

  if (mobile) {
    return activeTab ? renderComponent(activeTab) : renderComponent(SettingsTabs.Profile);
  }

  return (
    <>
      {Object.keys(componentMap).map((tabKey) => {
        const isProvider = tabKey === SettingsTabs.Provider;
        if (activeTab !== tabKey) return null;
        const content = renderComponent(tabKey);
        if (isProvider) return <Fragment key={tabKey}>{content}</Fragment>;
        return (
          <Fragment key={tabKey}>
            <NavHeader />
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
