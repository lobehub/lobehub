import type { CSSProperties, PropsWithChildren } from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from 'react-router';
import { isRtlLang } from 'rtl-detect';
import { href as antdStaticCssHref } from 'virtual:lobehub/antd-static-css';
import { href as themeVarsCssHref } from 'virtual:lobehub/theme-vars-css';

import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

import { resolveAuthLocale } from './lib/locale';
import { buildAuthMeta } from './lib/seo';
import { SERVER_CONFIG_PLACEHOLDER } from './lib/serverConfig';
import AuthAppShell from './shell/AuthAppShell';
import { serializeAuthResources } from './shell/authResources';
import { AUTH_I18N_SCRIPT_ID } from './shell/i18nScript';

const bodyBackground = `
html body { background: #f8f8f8; }
html[data-theme='dark'] body { background-color: #000; }
`;

// Only reaches the document on the SPA fallback shell, which matches no route:
// every page route replaces the whole set with its own.
export const meta = () => buildAuthMeta(resolveAuthLocale(), '/');

export const Layout = ({ children }: PropsWithChildren) => {
  const locale = resolveAuthLocale();

  return (
    <html suppressHydrationWarning dir={isRtlLang(locale) ? 'rtl' : 'ltr'} lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <link href="/favicon.ico" rel="icon" />
        <Meta />
        <Links />
        <style dangerouslySetInnerHTML={{ __html: bodyBackground }} />
        <link href={themeVarsCssHref} rel="stylesheet" />
        <link href={antdStaticCssHref} rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: SERVER_CONFIG_PLACEHOLDER }} />
        <script
          dangerouslySetInnerHTML={{ __html: serializeAuthResources(locale) }}
          id={AUTH_I18N_SCRIPT_ID}
          type={'application/json'}
        />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
};

export default function Root() {
  const locale = resolveAuthLocale();

  return (
    <NextThemeProvider>
      <AuthAppShell locale={locale}>
        <Outlet />
      </AuthAppShell>
    </NextThemeProvider>
  );
}

const buttonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid currentcolor',
  borderRadius: 6,
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  padding: '6px 16px',
};

// Replaces Root, so it renders without the i18n provider: plain markup and
// English copy only, matching the auth SPA's own boundary.
export const ErrorBoundary = () => {
  const error = useRouteError();

  if (typeof window !== 'undefined' && isChunkLoadError(error)) notifyChunkError();

  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'sans-serif',
        gap: 16,
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: 16,
      }}
    >
      <h2 style={{ margin: 0 }}>Something went wrong</h2>
      <div style={{ display: 'flex', gap: 12 }}>
        <button style={buttonStyle} type={'button'} onClick={() => window.location.reload()}>
          Retry
        </button>
        <button
          style={buttonStyle}
          type={'button'}
          onClick={() => {
            window.location.href = '/signin';
          }}
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
};
