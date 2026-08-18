import { BRANDING_NAME } from '@lobechat/business-const';
import type { CSSProperties, PropsWithChildren } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  useRouteLoaderData,
} from 'react-router';
import { isRtlLang } from 'rtl-detect';
import { href as antdStaticCssHref } from 'virtual:lobehub/antd-static-css';
import { href as themeVarsCssHref } from 'virtual:lobehub/theme-vars-css';

import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { normalizeLocale } from '@/locales/resources';
import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

import WorkbenchShell from '../src/shell';
import { loadWorkbenchResources } from '../src/shell/createWorkbenchI18n';
import { buildPageMeta, workbenchMetaDescription } from './lib/seo';

const pickLocale = (request: Request) => {
  const url = new URL(request.url);
  const hl = url.searchParams.get('hl');
  const cookie = request.headers.get('cookie') ?? '';
  const cookieLocale = decodeURIComponent(/(?:^|;\s*)LOBE_LOCALE=([^;]*)/.exec(cookie)?.[1] ?? '');
  const acceptLocale = request.headers.get('accept-language')?.split(',')[0]?.trim() ?? '';

  const raw = hl || cookieLocale || acceptLocale || 'en-US';

  return normalizeLocale(raw === 'auto' ? acceptLocale || 'en-US' : raw);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const locale = pickLocale(request);
  const resources = await loadWorkbenchResources(locale);

  return {
    dir: isRtlLang(locale) ? 'rtl' : 'ltr',
    locale,
    resources,
  };
};

export const meta: MetaFunction<typeof loader> = ({ loaderData }) =>
  buildPageMeta({
    description: workbenchMetaDescription(loaderData?.resources),
    locale: loaderData?.locale,
    title: BRANDING_NAME,
  });

const bodyBackground = `
html body { background: #f8f8f8; }
html[data-theme='dark'] body { background-color: #000; }
`;

export const Layout = ({ children }: PropsWithChildren) => {
  const data = useRouteLoaderData<typeof loader>('root');

  return (
    <html suppressHydrationWarning dir={data?.dir ?? 'ltr'} lang={data?.locale ?? 'en-US'}>
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <Meta />
        <Links />
        <style dangerouslySetInnerHTML={{ __html: bodyBackground }} />
        <link href={themeVarsCssHref} rel="stylesheet" />
        <link href={antdStaticCssHref} rel="stylesheet" />
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
  const data = useRouteLoaderData<typeof loader>('root');

  return (
    <NextThemeProvider>
      <WorkbenchShell locale={data?.locale} resources={data?.resources} serverConfig={null}>
        <Outlet />
      </WorkbenchShell>
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

export const ErrorBoundary = () => {
  const error = useRouteError() as Error;

  if (typeof window !== 'undefined' && isChunkLoadError(error)) notifyChunkError();

  const detail =
    error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : JSON.stringify(error);

  return (
    <div
      style={{
        alignItems: 'center',
        color: 'inherit',
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
        <button style={buttonStyle} type={'button'} onClick={() => window.location.assign('/')}>
          Back
        </button>
      </div>
      <pre
        style={{
          background: 'rgba(125, 125, 125, 0.1)',
          borderRadius: 8,
          fontSize: 12,
          maxHeight: '40dvh',
          maxWidth: 720,
          overflow: 'auto',
          padding: 12,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {detail}
      </pre>
    </div>
  );
};
