import { BRANDING_NAME, ORG_NAME } from '@lobechat/business-const';
import { OG_URL } from '@lobechat/const';

import { getServerFeatureFlagsValue } from '@/config/featureFlags';
import { OFFICIAL_URL } from '@/const/url';
import { isCustomORG } from '@/const/version';
import { appEnv } from '@/envs/app';
import { fileEnv } from '@/envs/file';
import { pythonEnv } from '@/envs/python';
import { translation } from '@/libs/i18n/serverTranslation';
import { buildAnalyticsConfig, renderSpaHtml } from '@/libs/spaHtml';
import { type Locales, normalizeLocale } from '@/locales/resources';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { type SPAClientEnv, type SPAServerConfig } from '@/types/spaServerConfig';

export function generateStaticParams() {
  const staticLocales: Locales[] = ['en-US', 'zh-CN'];

  return staticLocales.map((locale) => ({ locale }));
}

// No dev branch here: share is developed against its own Vite server
// (`dev:spa:share`), and asking the main one for a shell it doesn't own gets the
// main SPA back through the HTML fallback — silently, since that responds 200.
async function getTemplate(): Promise<string> {
  const { shareHtmlTemplate } = await import('../../shareHtmlTemplate');

  return shareHtmlTemplate;
}

function buildClientEnv(): SPAClientEnv {
  return {
    marketBaseUrl: appEnv.MARKET_BASE_URL,
    pyodideIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_INDEX_URL,
    pyodidePipIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_PIP_INDEX_URL,
    s3FilePath: fileEnv.NEXT_PUBLIC_S3_FILE_PATH,
  };
}

// Self-hosted share pages render client-side, so the document carries the brand
// card rather than the shared topic — the same card `/share/*` got while it was
// part of the main SPA shell. Per-topic OG lives in the Cloudflare worker build.
async function buildSeoMeta(locale: string): Promise<string> {
  const { t } = await translation('metadata', locale);
  const title = t('chat.title', { appName: BRANDING_NAME });
  const description = t('chat.description', { appName: BRANDING_NAME });

  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    '<meta name="robots" content="noindex, nofollow" />',
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="article" />`,
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
  { params }: { params: Promise<{ locale: string; path?: string[] }> },
) {
  const { locale: rawLocale } = await params;
  const locale = normalizeLocale(rawLocale);

  const spaConfig: SPAServerConfig = {
    analyticsConfig: buildAnalyticsConfig(),
    clientEnv: buildClientEnv(),
    config: await getServerGlobalConfig(),
    featureFlags: getServerFeatureFlagsValue(),
    isMobile: false,
  };

  const template = await getTemplate();

  return renderSpaHtml(template, { seoMeta: await buildSeoMeta(locale), serverConfig: spaConfig });
}
