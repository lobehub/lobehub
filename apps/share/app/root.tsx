import { BRANDING_NAME } from '@lobechat/business-const';
import type { PropsWithChildren } from 'react';
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

import ErrorCapture, { type ErrorType } from '@/components/Error';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { resolveRequestLocale } from '@/locales/requestLocale';
import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

import ShareAppShell from '../src/shell';
import { loadShareResources } from '../src/shell/createShareI18n';
import { buildPageMeta, shareMetaDescription } from './lib/seo';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const locale = resolveRequestLocale(request);
  const resources = await loadShareResources(locale);

  return {
    dir: isRtlLang(locale) ? 'rtl' : 'ltr',
    locale,
    resources,
  };
};

export const meta: MetaFunction<typeof loader> = ({ loaderData }) =>
  buildPageMeta({
    description: shareMetaDescription(loaderData?.resources, 'topicDescription'),
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
        <link href="/favicon.ico" rel="icon" />
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
      <ShareAppShell locale={data?.locale} resources={data?.resources} serverConfig={null}>
        <Outlet />
      </ShareAppShell>
    </NextThemeProvider>
  );
}

export const ErrorBoundary = () => {
  const rawError = useRouteError();
  const data = useRouteLoaderData<typeof loader>('root');

  if (typeof window !== 'undefined' && isChunkLoadError(rawError)) notifyChunkError();

  const error =
    rawError instanceof Error ? (rawError as ErrorType) : new Error(JSON.stringify(rawError));

  // The boundary replaces Root, so it must rebuild the provider shell itself
  // (theme + i18n) for the shared error page to render properly.
  return (
    <NextThemeProvider>
      <ShareAppShell locale={data?.locale} resources={data?.resources} serverConfig={null}>
        <ErrorCapture error={error} />
      </ShareAppShell>
    </NextThemeProvider>
  );
};
