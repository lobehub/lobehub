import { analyticsEnv } from '@/envs/analytics';
import { serializeForHtml } from '@/server/utils/serializeForHtml';
import { type AnalyticsConfig } from '@/types/spaServerConfig';

// VITE_DEV_PORT is injected by scripts/devStartupSequence.mts with the actual
// port of the Vite dev server it spawned; 9876 matches the standalone default.
export const resolveViteDevOrigin = () =>
  `http://localhost:${Number(process.env.VITE_DEV_PORT) || 9876}`;

const SERVER_CONFIG_PLACEHOLDER =
  /window\.__SERVER_CONFIG__\s*=\s*undefined;\s*\/\*\s*SERVER_CONFIG\s*\*\//;

async function rewriteViteAssetUrls(
  html: string,
  origin = resolveViteDevOrigin(),
): Promise<string> {
  const { parseHTML } = await import('linkedom');
  const { document } = parseHTML(html);

  document.querySelectorAll('script[src]').forEach((el: Element) => {
    const src = el.getAttribute('src');
    if (src && src.startsWith('/')) {
      el.setAttribute('src', `${origin}${src}`);
    }
  });

  document.querySelectorAll('link[href]').forEach((el: Element) => {
    const href = el.getAttribute('href');
    if (href && href.startsWith('/')) {
      el.setAttribute('href', `${origin}${href}`);
    }
  });

  document.querySelectorAll('script[type="module"]:not([src])').forEach((el: Element) => {
    const text = el.textContent || '';
    if (text.includes('/@')) {
      el.textContent = text.replaceAll(
        /from\s+["'](\/[@\w].*?)["']/g,
        (_match: string, p: string) => `from "${origin}${p}"`,
      );
    }
  });

  const workerPatch = document.createElement('script');
  workerPatch.textContent = `(function(){
var O=globalThis.Worker;
globalThis.Worker=function(u,o){
var h=typeof u==='string'?u:u instanceof URL?u.href:'';
if(h.startsWith('${origin}')){
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

export async function fetchViteDevTemplate(
  pathname = '/',
  origin = resolveViteDevOrigin(),
): Promise<string> {
  const res = await fetch(`${origin}${pathname}`);
  const html = await res.text();

  return rewriteViteAssetUrls(html, origin);
}

export function buildAnalyticsConfig(options: { desktop?: boolean } = {}): AnalyticsConfig {
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

  if (analyticsEnv.ENABLED_X_ADS && analyticsEnv.X_ADS_PIXEL_ID) {
    config.xAds = {
      eventIds: {
        login_or_signup_clicked: analyticsEnv.X_ADS_LOGIN_OR_SIGNUP_CLICKED_EVENT_ID,
        main_page_view: analyticsEnv.X_ADS_MAIN_PAGE_VIEW_EVENT_ID,
      },
      pixelId: analyticsEnv.X_ADS_PIXEL_ID,
      purchaseEventId: analyticsEnv.X_ADS_PURCHASE_EVENT_ID,
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
    options.desktop &&
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

export function renderSpaHtml(
  template: string,
  options: { seoMeta: string; serverConfig: unknown },
): Response {
  let html = template.replace(
    SERVER_CONFIG_PLACEHOLDER,
    `window.__SERVER_CONFIG__ = ${serializeForHtml(options.serverConfig)};`,
  );

  html = html.replace('<!--SEO_META-->', options.seoMeta);
  html = html.replace('<!--ANALYTICS_SCRIPTS-->', '');

  return new Response(html, {
    headers: {
      'Cache-Control': 'no-cache',
      'content-type': 'text/html; charset=utf-8',
    },
  });
}
