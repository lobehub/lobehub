import { BRANDING_NAME, ORG_NAME } from '@lobechat/business-const';
import { OG_URL } from '@lobechat/const';

import { getServerFeatureFlagsValue } from '@/config/featureFlags';
import { OFFICIAL_URL } from '@/const/url';
import { isCustomORG, isDesktop } from '@/const/version';
import { analyticsEnv } from '@/envs/analytics';
import { appEnv } from '@/envs/app';
import { fileEnv } from '@/envs/file';
import { pythonEnv } from '@/envs/python';
import { type Locales } from '@/locales/resources';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { translation } from '@/server/translation';
import { serializeForHtml } from '@/server/utils/serializeForHtml';
import {
  type AnalyticsConfig,
  type SPAClientEnv,
  type SPAServerConfig,
} from '@/types/spaServerConfig';
import { RouteVariants } from '@/utils/server/routeVariants';

export const dynamic = 'force-static';

export function generateStaticParams() {
  const mobileOptions = isDesktop ? [false] : [true, false];
  const staticLocales: Locales[] = ['en-US', 'zh-CN'];

  const variants: { variants: string }[] = [];

  for (const locale of staticLocales) {
    for (const isMobile of mobileOptions) {
      variants.push({
        variants: RouteVariants.serializeVariants({ isMobile, locale }),
      });
    }
  }

  return variants;
}

const isDev = process.env.NODE_ENV === 'development';
const VITE_DEV_ORIGIN = 'http://localhost:9876';

async function rewriteViteAssetUrls(html: string): Promise<string> {
  const { parseHTML } = await import('linkedom');
  const { document } = parseHTML(html);

  document.querySelectorAll('script[src]').forEach((el: Element) => {
    const src = el.getAttribute('src');
    if (src && src.startsWith('/')) {
      el.setAttribute('src', `${VITE_DEV_ORIGIN}${src}`);
    }
  });

  document.querySelectorAll('link[href]').forEach((el: Element) => {
    const href = el.getAttribute('href');
    if (href && href.startsWith('/')) {
      el.setAttribute('href', `${VITE_DEV_ORIGIN}${href}`);
    }
  });

  document.querySelectorAll('script[type="module"]:not([src])').forEach((el: Element) => {
    const text = el.textContent || '';
    if (text.includes('/@')) {
      el.textContent = text.replaceAll(
        /from\s+["'](\/[@\w].*?)["']/g,
        (_match: string, p: string) => `from "${VITE_DEV_ORIGIN}${p}"`,
      );
    }
  });

  const workerPatch = document.createElement('script');
  workerPatch.textContent = `(function(){
var O=globalThis.Worker;
globalThis.Worker=function(u,o){
var h=typeof u==='string'?u:u instanceof URL?u.href:'';
if(h.startsWith('${VITE_DEV_ORIGIN}')){
var b=new Blob(['import "'+h+'";'],{type:'application/javascript'});
return new O(URL.createObjectURL(b),Object.assign({},o,{type:'module'}));
}return new O(u,o)};
globalThis.Worker.prototype=O.prototype;
})();`;
  const head = document.querySelector('head');
  if (head?.firstChild) {
    head.insertBefore(workerPatch, head.firstChild);
  }

  return document.toString();
}

async function getTemplate(isMobile: boolean): Promise<string> {
  if (isDev) {
    const res = await fetch(VITE_DEV_ORIGIN);
    const html = await res.text();
    return rewriteViteAssetUrls(html);
  }

  const { desktopHtmlTemplate, mobileHtmlTemplate } = await import('./spaHtmlTemplates');

  return isMobile ? mobileHtmlTemplate : desktopHtmlTemplate;
}

function buildAnalyticsConfig(): AnalyticsConfig {
  const config: AnalyticsConfig = {};

  if (analyticsEnv.ENABLE_GOOGLE_ANALYTICS && analyticsEnv.GOOGLE_ANALYTICS_MEASUREMENT_ID) {
    config.google = { measurementId: analyticsEnv.GOOGLE_ANALYTICS_MEASUREMENT_ID };
  }

  if (analyticsEnv.ENABLED_PLAUSIBLE_ANALYTICS && analyticsEnv.PLAUSIBLE_DOMAIN) {
    config.plausible = {
      domain: analyticsEnv.PLAUSIBLE_DOMAIN,
      scriptBaseUrl: analyticsEnv.PLAUSIBLE_SCRIPT_BASE_URL,
    };
  }

  if (analyticsEnv.ENABLED_UMAMI_ANALYTICS && analyticsEnv.UMAMI_WEBSITE_ID) {
    config.umami = {
      scriptUrl: analyticsEnv.UMAMI_SCRIPT_URL,
      websiteId: analyticsEnv.UMAMI_WEBSITE_ID,
    };
  }

  if (analyticsEnv.ENABLED_CLARITY_ANALYTICS && analyticsEnv.CLARITY_PROJECT_ID) {
    config.clarity = { projectId: analyticsEnv.CLARITY_PROJECT_ID };
  }

  if (analyticsEnv.ENABLED_POSTHOG_ANALYTICS && analyticsEnv.POSTHOG_KEY) {
    config.posthog = {
      debug: analyticsEnv.DEBUG_POSTHOG_ANALYTICS,
      host: analyticsEnv.POSTHOG_HOST,
      key: analyticsEnv.POSTHOG_KEY,
    };
  }

  if (analyticsEnv.REACT_SCAN_MONITOR_API_KEY) {
    config.reactScan = { apiKey: analyticsEnv.REACT_SCAN_MONITOR_API_KEY };
  }

  if (analyticsEnv.ENABLE_VERCEL_ANALYTICS) {
    config.vercel = {
      debug: analyticsEnv.DEBUG_VERCEL_ANALYTICS,
      enabled: true,
    };
  }

  if (
    process.env.NEXT_PUBLIC_DESKTOP_PROJECT_ID &&
    process.env.NEXT_PUBLIC_DESKTOP_UMAMI_BASE_URL
  ) {
    config.desktop = {
      baseUrl: process.env.NEXT_PUBLIC_DESKTOP_UMAMI_BASE_URL,
      projectId: process.env.NEXT_PUBLIC_DESKTOP_PROJECT_ID,
    };
  }

  return config;
}

function buildClientEnv(): SPAClientEnv {
  return {
    marketBaseUrl: appEnv.MARKET_BASE_URL,
    pyodideIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_INDEX_URL,
    pyodidePipIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_PIP_INDEX_URL,
    s3FilePath: fileEnv.NEXT_PUBLIC_S3_FILE_PATH,
  };
}

async function buildSeoMeta(locale: string): Promise<string> {
  const { t } = await translation('metadata', locale);
  const title = t('chat.title', { appName: BRANDING_NAME });
  const description = t('chat.description', { appName: BRANDING_NAME });

  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${OFFICIAL_URL}" />`,
    `<meta property="og:image" content="${OG_URL}" />`,
    `<meta property="og:site_name" content="${BRANDING_NAME}" />`,
    `<meta property="og:locale" content="${locale}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${OG_URL}" />`,
    `<meta name="twitter:site" content="${isCustomORG ? `@${ORG_NAME}` : '@lobehub'}" />`,
  ].join('\n    ');
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path?: string[]; variants: string }> },
) {
  const { variants } = await params;
  const { locale, isMobile } = RouteVariants.deserializeVariants(variants);

  const serverConfig = await getServerGlobalConfig();
  const featureFlags = getServerFeatureFlagsValue();
  const analyticsConfig = buildAnalyticsConfig();
  const clientEnv = buildClientEnv();

  const spaConfig: SPAServerConfig = {
    analyticsConfig,
    clientEnv,
    config: serverConfig,
    featureFlags,
    isMobile,
  };

  let html = await getTemplate(isMobile);

  html = html.replace(
    /window\.__SERVER_CONFIG__\s*=\s*undefined;\s*\/\*\s*SERVER_CONFIG\s*\*\//,
    `window.__SERVER_CONFIG__ = ${serializeForHtml(spaConfig)};`,
  );

  const seoMeta = await buildSeoMeta(locale);
  html = html.replace('<!--SEO_META-->', seoMeta);
  html = html.replace('<!--ANALYTICS_SCRIPTS-->', '');

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });
}
