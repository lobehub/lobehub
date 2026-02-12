import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { ContextMenuHost, ModalHost, ToastHost, TooltipGroup } from '@lobehub/ui';
import { domMax, LazyMotion } from 'motion/react';
import { type ReactNode } from 'react';
import { Suspense } from 'react';

import { ReferralProvider } from '@/business/client/ReferralProvider';
import { LobeAnalyticsProviderWrapper } from '@/components/Analytics/LobeAnalyticsProviderWrapper';
import { DragUploadProvider } from '@/components/DragUploadZone/DragUploadProvider';
import { getServerFeatureFlagsValue } from '@/config/featureFlags';
import { isDesktop } from '@/const/version';
import { appEnv } from '@/envs/app';
import DevPanel from '@/features/DevPanel';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import { getAntdLocale } from '@/utils/locale';

import AppTheme from './AppTheme';
import { FaviconProvider } from './FaviconProvider';
import { GroupWizardProvider } from './GroupWizardProvider';
import ImportSettings from './ImportSettings';
import Locale from './Locale';
import NextThemeProvider from './NextThemeProvider';
import QueryProvider from './Query';
import ServerVersionOutdatedAlert from './ServerVersionOutdatedAlert';
import StoreInitialization from './StoreInitialization';
import StyleRegistry from './StyleRegistry';

interface GlobalLayoutProps {
  children: ReactNode;
  isMobile: boolean;
  locale: string;
  neutralColor?: string;
  primaryColor?: string;
  variants?: string;
}

const GlobalLayout = async ({
  children,
  neutralColor,
  primaryColor,
  locale: userLocale,

  isMobile,
  variants,
}: GlobalLayoutProps) => {
  const antdLocale = await getAntdLocale(userLocale);

  // get default feature flags to use with ssr
  const serverFeatureFlags = getServerFeatureFlagsValue();
  const serverConfig = await getServerGlobalConfig();

  return (
    <StyleRegistry>
      <Locale antdLocale={antdLocale} defaultLang={userLocale}>
        <NextThemeProvider>
          <AppTheme
            customFontFamily={appEnv.CUSTOM_FONT_FAMILY}
            customFontURL={appEnv.CUSTOM_FONT_URL}
            defaultNeutralColor={neutralColor as any}
            defaultPrimaryColor={primaryColor as any}
            globalCDN={appEnv.CDN_USE_GLOBAL}
          >
            <ServerConfigStoreProvider
              featureFlags={serverFeatureFlags}
              isMobile={isMobile}
              segmentVariants={variants}
              serverConfig={serverConfig}
            >
              <QueryProvider>
                <StoreInitialization />

                {isDesktop && <ServerVersionOutdatedAlert />}
                <FaviconProvider>
                  <GroupWizardProvider>
                    <DragUploadProvider>
                      <LazyMotion features={domMax}>
                        <TooltipGroup layoutAnimation={false}>
                          <LobeAnalyticsProviderWrapper>{children}</LobeAnalyticsProviderWrapper>
                        </TooltipGroup>
                        <ModalHost />
                        <ToastHost />
                        <ContextMenuHost />
                      </LazyMotion>
                    </DragUploadProvider>
                  </GroupWizardProvider>
                </FaviconProvider>
              </QueryProvider>
              <Suspense>
                {ENABLE_BUSINESS_FEATURES ? <ReferralProvider /> : null}
                <ImportSettings />
                {process.env.NODE_ENV === 'development' && <DevPanel />}
              </Suspense>
            </ServerConfigStoreProvider>
          </AppTheme>
        </NextThemeProvider>
      </Locale>
    </StyleRegistry>
  );
};

export default GlobalLayout;
