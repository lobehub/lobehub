import { BRANDING_NAME } from '@lobechat/business-const';

import { getServerFeatureFlagsValue } from '@/config/featureFlags';
import { appEnv } from '@/envs/app';
import { fileEnv } from '@/envs/file';
import { pythonEnv } from '@/envs/python';
import { buildAnalyticsConfig, fetchViteDevTemplate, renderSpaHtml } from '@/libs/spaHtml';
import { type Locales, normalizeLocale } from '@/locales/resources';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { type SPAClientEnv, type SPAServerConfig } from '@/types/spaServerConfig';

export function generateStaticParams() {
  const staticLocales: Locales[] = ['en-US', 'zh-CN'];

  return staticLocales.map((locale) => ({ locale }));
}

const isDev = process.env.NODE_ENV === 'development';

async function getTemplate(): Promise<string> {
  if (isDev) return fetchViteDevTemplate('/index.workbench.html');

  const { workbenchHtmlTemplate } = await import('../../workbenchHtmlTemplate');

  return workbenchHtmlTemplate;
}

function buildClientEnv(): SPAClientEnv {
  return {
    marketBaseUrl: appEnv.MARKET_BASE_URL,
    pyodideIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_INDEX_URL,
    pyodidePipIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_PIP_INDEX_URL,
    s3FilePath: fileEnv.NEXT_PUBLIC_S3_FILE_PATH,
  };
}

const buildSeoMeta = (locale: string) =>
  [
    `<title>${BRANDING_NAME}</title>`,
    '<meta name="robots" content="noindex, nofollow" />',
    `<meta property="og:locale" content="${locale}" />`,
  ].join('\n    ');

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
    isMobile: true,
  };

  const template = await getTemplate();

  return renderSpaHtml(template, { seoMeta: buildSeoMeta(locale), serverConfig: spaConfig });
}
