import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { type ResolvingViewport } from 'next';
import Script from 'next/script';
import { type ReactNode, Suspense } from 'react';
import { isRtlLang } from 'rtl-detect';

import BusinessGlobalProvider from '@/business/client/BusinessGlobalProvider';
import Analytics from '@/components/Analytics';
import { DEFAULT_LANG } from '@/const/locale';
import { isDesktop } from '@/const/version';
import PWAInstall from '@/features/PWAInstall';
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
        <Suspense fallback={null}>
          <PWAInstall />
        </Suspense>
      </GlobalProvider>
    );
  };

  return (
    <html dir={direction} lang={locale} suppressHydrationWarning>
      <head>
        {/* <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  const SELECTOR =
    '#lobe-ui-theme-app > div > div > div:nth-child(2) > div > div > div > span.ant-tag';
  const VAR_NAME = '--ant-color-fill-tertiary';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitForElement(selector, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(50);
    }
    throw new Error(\`[cssvar watch] element not found within \${timeoutMs}ms: \${selector}\`);
  }

  function readState(el) {
    const elCS = getComputedStyle(el);
    const rootCS = getComputedStyle(document.documentElement);

    // 变量值（可能是 rgba/hex/hsl 等字符串）
    const varValue = rootCS.getPropertyValue(VAR_NAME).trim();

    // computed 背景（通常会解析成 rgb/rgba）
    const bgColor = elCS.backgroundColor; // 最常用
    const bg = elCS.background;           // 更完整，可能包含 image/repeat 等

    return { varValue, bgColor, bg };
  }

  function diff(prev, next) {
    const changed = {};
    for (const k of Object.keys(next)) {
      if (prev[k] !== next[k]) changed[k] = { from: prev[k], to: next[k] };
    }
    return changed;
  }

  (async () => {
    const el = await waitForElement(SELECTOR, 20000);
    console.log('[cssvar watch] target found:', el);

    let prev = readState(el);
    console.log('[cssvar watch] start state:', prev);

    const reportIfChanged = (reason, muts) => {
      const next = readState(el);
      const changed = diff(prev, next);
      if (Object.keys(changed).length) {
        console.groupCollapsed(
          \`[cssvar watch] changed (\${reason}) @ \${new Date().toISOString()}\`
        );
        console.log('changed:', changed);
        if (muts) console.log('mutations:', muts);
        console.log('element:', el);
        console.groupEnd();

        prev = next;

        // 想“一变就停住”就保留；不想断就注释掉
        debugger;
      }
    };

    // 1) 盯 DOM/CSS 相关变化：class/style 属性、style 标签内容等
    const mo = new MutationObserver((muts) => {
      // 粗略过滤一下：减少无意义触发
      for (const m of muts) {
        if (m.type === 'attributes') {
          if (m.attributeName === 'class' || m.attributeName === 'style') {
            reportIfChanged('attribute mutation', muts);
            return;
          }
        } else {
          // childList / characterData：常见于 <style> 内容变化、主题注入
          reportIfChanged('dom mutation', muts);
          return;
        }
      }
    });

    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    // 2) 额外盯目标元素自身（有的库会直接改它的 class/style）
    const moEl = new MutationObserver((muts) => reportIfChanged('target mutation', muts));
    moEl.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });

    // 3) Hook setProperty：谁改了 VAR_NAME 立刻抓到
    const origSetProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
      const r = origSetProperty.call(this, name, value, priority);
      if (name === VAR_NAME) {
        console.groupCollapsed(
          \`[cssvar watch] setProperty(\${name}) = \${String(value)} @ \${new Date().toISOString()}\`
        );
        console.log('priority:', priority);
        console.log('styleDeclaration:', this);
        console.trace('stack');
        console.groupEnd();

        reportIfChanged('setProperty hook');
        // 想直接停在改变量的那一行，就保留
        debugger;
      }
      return r;
    };

    console.log('[cssvar watch] armed: MutationObserver + setProperty hook');
    console.log('[cssvar watch] watching:', { SELECTOR, VAR_NAME });
  })().catch((e) => console.error(e));
})();
`,
          }}
        /> */}
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
  // only static for serveral page, other go to dynamtic
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
