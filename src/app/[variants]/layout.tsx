import './initialize';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { type ResolvingViewport } from 'next';
import Script from 'next/script';
import { type ReactNode } from 'react';
import { Suspense } from 'react';
import { isRtlLang } from 'rtl-detect';

import BusinessGlobalProvider from '@/business/client/BusinessGlobalProvider';
import Analytics from '@/components/Analytics';
import { DEFAULT_LANG } from '@/const/locale';
import { isDesktop } from '@/const/version';
import AuthProvider from '@/layout/AuthProvider';
import GlobalProvider from '@/layout/GlobalProvider';
import { type Locales } from '@/locales/resources';
import { type DynamicLayoutProps } from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

const inVercel = process.env.VERCEL === '1';

export interface RootLayoutProps extends DynamicLayoutProps {
  children: ReactNode;
}

const RootLayout = async ({ children, params }: RootLayoutProps) => {
  const { variants } = await params;

  const { locale, isMobile, primaryColor, neutralColor } =
    RouteVariants.deserializeVariants(variants);

  const direction = isRtlLang(locale) ? 'rtl' : 'ltr';

  const renderContent = () => {
    return (
      <GlobalProvider
        isMobile={isMobile}
        locale={locale}
        neutralColor={neutralColor}
        primaryColor={primaryColor}
        variants={variants}
      >
        <AuthProvider>{children}</AuthProvider>
      </GlobalProvider>
    );
  };

  return (
    <html suppressHydrationWarning dir={direction} lang={locale}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(${outdateBrowserScript.toString()})();` }} />
        {process.env.DEBUG_REACT_SCAN === '1' && (
          <Script
            crossOrigin={'anonymous'}
            src={'https://unpkg.com/react-scan/dist/auto.global.js'}
            strategy={'lazyOnload'}
          />
        )}
      </head>
      <body>
        {ENABLE_BUSINESS_FEATURES ? (
          <BusinessGlobalProvider>{renderContent()}</BusinessGlobalProvider>
        ) : (
          renderContent()
        )}
        <Suspense fallback={null}>
          <Analytics />
          {inVercel && <SpeedInsights />}
        </Suspense>
      </body>
    </html>
  );
};

function outdateBrowserScript() {
  function supportsImportMaps(): boolean {
    return (
      typeof HTMLScriptElement !== 'undefined' &&
      typeof (HTMLScriptElement as any).supports === 'function' &&
      (HTMLScriptElement as any).supports('importmap')
    );
  }

  function supportsCascadeLayers(): boolean {
    if (typeof document === 'undefined') return false;

    const el = document.createElement('div');
    el.className = '__layer_test__';
    el.style.position = 'absolute';
    el.style.left = '-99999px';
    el.style.top = '-99999px';

    const style = document.createElement('style');
    style.textContent = `
      @layer a, b;
      @layer a { .__layer_test__ { color: rgb(1, 2, 3); } }
      @layer b { .__layer_test__ { color: rgb(4, 5, 6); } }
    `;

    document.documentElement.append(style);
    document.documentElement.append(el);

    const color = getComputedStyle(el).color;

    el.remove();
    style.remove();

    return color === 'rgb(4, 5, 6)';
  }

  const isOutdateBrowser = !(supportsImportMaps() && supportsCascadeLayers());
  if (isOutdateBrowser) {
    window.location.href = '/not-compatible.html';
    return true;
  }
  return false;
}

export default RootLayout;

export { generateMetadata } from './metadata';

export const generateViewport = async (props: DynamicLayoutProps): ResolvingViewport => {
  const isMobile = await RouteVariants.getIsMobile(props);

  const dynamicScale = isMobile ? { maximumScale: 1, userScalable: false } : {};

  return {
    ...dynamicScale,
    colorScheme: null,
    initialScale: 1,
    minimumScale: 1,
    themeColor: [
      { color: '#f8f8f8', media: '(prefers-color-scheme: light)' },
      { color: '#000', media: '(prefers-color-scheme: dark)' },
    ],
    viewportFit: 'cover',
    width: 'device-width',
  };
};

export const generateStaticParams = () => {
  const mobileOptions = isDesktop ? [false] : [true, false];
  // only static for several page, other go to dynamic
  const staticLocales: Locales[] = [DEFAULT_LANG, 'zh-CN'];

  const variants: { variants: string }[] = [];

  for (const locale of staticLocales) {
    for (const isMobile of mobileOptions) {
      variants.push({
        variants: RouteVariants.serializeVariants({
          isMobile,
          locale,
        }),
      });
    }
  }

  return variants;
};
