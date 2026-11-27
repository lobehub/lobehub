import '@/styles/stylex.css';

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

import ErrorCapture, { type ErrorType } from '@/components/Error';
import { AppOriginContext } from '@/hooks/appOriginContext';
import { resolveRequestLocale } from '@/locales/requestLocale';
import { isChunkLoadError, notifyChunkError } from '@/utils/chunkError';

import { parseAcceptanceEmbedConfig } from '../src/shell/acceptanceEmbed';
import AcceptanceEmbedShell from '../src/shell/AcceptanceEmbedShell';
import { loadWorkbenchResources } from '../src/shell/createWorkbenchI18n';
import { cloudflareContext } from './lib/cloudflareContext';
import { buildPageMeta, workbenchMetaDescription } from './lib/seo';

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const appHome = context.get(cloudflareContext).env.WORKBENCH_APP_HOME as string | undefined;
  const locale = resolveRequestLocale(request);
  const resources = await loadWorkbenchResources(locale);
  const embedConfig = parseAcceptanceEmbedConfig(request.url);

  return {
    appOrigin: new URL(appHome || request.url).origin,
    dir: isRtlLang(locale) ? 'rtl' : 'ltr',
    embedConfig,
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
    <html
      suppressHydrationWarning
      data-theme={data?.embedConfig.theme}
      dir={data?.dir ?? 'ltr'}
      lang={data?.locale ?? 'en-US'}
      // Override global.css's scroll containment so an embedded report yields to its host page.
      style={data?.embedConfig.embed ? { overscrollBehaviorY: 'auto' } : undefined}
    >
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <Meta />
        <Links />
        <style dangerouslySetInnerHTML={{ __html: bodyBackground }} />
      </head>
      <body>
        <AppOriginContext value={data?.appOrigin}>{children}</AppOriginContext>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
};

export default function Root() {
  const data = useRouteLoaderData<typeof loader>('root');

  return (
    <AcceptanceEmbedShell
      embed={data?.embedConfig.embed ?? false}
      initialLocale={data?.locale}
      initialTheme={data?.embedConfig.theme}
      resources={data?.resources}
    >
      <Outlet />
    </AcceptanceEmbedShell>
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
    <AcceptanceEmbedShell embed={false} initialLocale={data?.locale} resources={data?.resources}>
      <ErrorCapture error={error} />
    </AcceptanceEmbedShell>
  );
};
